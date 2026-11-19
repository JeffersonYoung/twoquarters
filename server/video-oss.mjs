import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { ossClient, ossEnabled } from './oss.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const videoCdnEnabled = ossEnabled && process.env.VIDEO_CDN_ENABLED === '1';
export function videoKey(id) {
  if (!uuid.test(id)) throw new Error('Invalid video ID');
  return `api/videos/${id}`;
}
export function publishedVideo(db, uri, method) {
  if (!['GET', 'HEAD'].includes(method) || typeof uri !== 'string') return false;
  const id = uri.startsWith('/api/videos/') ? uri.slice(12) : '';
  if (!uuid.test(id)) return false;
  return !!db.prepare(`SELECT 1 FROM videos JOIN projects ON projects.id=videos.project_id
    WHERE videos.id=? AND videos.status='ready' AND projects.published=1`).get(id);
}

// Stream hashes and upload a file path: a 250 MiB video must not be buffered in RAM.
export async function putVideo(id, filename, contentType, client) {
  if (!client && !ossEnabled) return;
  const key = videoKey(id);
  if (!['video/mp4', 'video/webm'].includes(contentType)) throw new Error('Invalid video type');
  client ||= await ossClient();
  const sha = createHash('sha256'), md5 = createHash('md5');
  let size = 0;
  for await (const chunk of createReadStream(filename)) { size += chunk.length; sha.update(chunk); md5.update(chunk); }
  const hash = sha.digest('hex'), checksum = md5.digest('base64');
  const matches = head => head?.meta?.sha256 === hash && Number(head.res.headers['content-length']) === size
    && head.res.headers['content-type'] === contentType;
  let head;
  try { head = await client.head(key); } catch (error) { if (error.status !== 404) throw error; }
  if (matches(head)) return { uploaded: false, bytes: size, sha256: hash };
  await client.put(key, filename, { mime: contentType, timeout: 120000,
    headers: { 'Content-MD5': checksum, 'Cache-Control': 'public, max-age=0, s-maxage=86400, must-revalidate' },
    meta: { sha256: hash },
  });
  if (!matches(await client.head(key))) throw new Error(`OSS video verification failed: ${id}`);
  return { uploaded: true, bytes: size, sha256: hash };
}
export async function deleteVideoObject(id) {
  if (ossEnabled) await (await ossClient()).delete(videoKey(id));
}
