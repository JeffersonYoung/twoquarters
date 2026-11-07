import OSS from 'ali-oss';
import { createHash } from 'node:crypto';

const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function originalKey(id) {
  if (!idPattern.test(id)) throw new Error('Invalid original image ID');
  return `api/images/${id}`;
}

// Only published originals are exposed through the shared CDN, even on cache hits.
export function publishedOriginal(db, uri, method) {
  if (!['GET', 'HEAD'].includes(method) || typeof uri !== 'string') return false;
  const id = uri.startsWith('/api/images/') ? uri.slice(12) : '';
  if (!idPattern.test(id)) return false;
  return !!db.prepare(`SELECT 1 FROM projects, json_each(projects.data,'$.images') AS image
    WHERE projects.published=1 AND json_extract(image.value,'$.id')=?
    AND json_extract(image.value,'$.storagePath') IS NOT NULL LIMIT 1`).get(id);
}

export const ossEnabled = !!process.env.OSS_BUCKET;
let clientPromise;
async function credentials() {
  const role = process.env.OSS_RAM_ROLE;
  if (!role || !/^[A-Za-z0-9_-]+$/.test(role)) throw new Error('OSS_RAM_ROLE is required');
  const base = 'http://100.100.100.200/latest';
  const tokenResponse = await fetch(`${base}/api/token`, {
    method: 'PUT', headers: { 'X-aliyun-ecs-metadata-token-ttl-seconds': '60' }, signal: AbortSignal.timeout(5000),
  });
  if (!tokenResponse.ok) throw new Error('ECS metadata token unavailable');
  const response = await fetch(`${base}/meta-data/ram/security-credentials/${role}`, {
    headers: { 'X-aliyun-ecs-metadata-token': await tokenResponse.text() }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('ECS role credentials unavailable');
  const value = await response.json();
  if (value.Code !== 'Success') throw new Error('ECS role credentials unavailable');
  return { accessKeyId: value.AccessKeyId, accessKeySecret: value.AccessKeySecret, stsToken: value.SecurityToken };
}
export async function ossClient() {
  if (!ossEnabled) throw new Error('OSS is not configured');
  if (!clientPromise) clientPromise = (async () => new OSS({
    region: process.env.OSS_REGION || 'oss-cn-beijing', bucket: process.env.OSS_BUCKET,
    internal: true, secure: true, timeout: 60000, ...(await credentials()),
    refreshSTSToken: credentials, refreshSTSTokenInterval: 5 * 60 * 1000,
  }))().catch(error => { clientPromise = undefined; throw error; });
  return clientPromise;
}
export async function putOriginal(id, bytes, contentType) {
  if (!ossEnabled) return;
  const client = await ossClient();
  await client.put(originalKey(id), bytes, {
    mime: contentType,
    headers: { 'Content-MD5': createHash('md5').update(bytes).digest('base64'),
      'Cache-Control': 'public, max-age=0, s-maxage=86400, must-revalidate' },
    meta: { sha256: createHash('sha256').update(bytes).digest('hex') },
  });
}
export async function deleteOriginal(id) {
  if (ossEnabled) await (await ossClient()).delete(originalKey(id));
}
