import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { db, dataDir } from '../server/store.mjs';
import { ossClient, originalKey, putOriginal } from '../server/oss.mjs';

const client = await ossClient();
const originals = new Map();
for (const row of db.prepare('SELECT data FROM projects').all()) {
  for (const image of JSON.parse(row.data).images || []) if (image.storagePath) originals.set(image.id, image);
}
let uploaded = 0, existing = 0, bytesTotal = 0;
for (const image of originals.values()) {
  const key = originalKey(image.id);
  const bytes = await readFile(path.join(dataDir, 'uploads', image.id));
  const hash = createHash('sha256').update(bytes).digest('hex');
  let head;
  try { head = await client.head(key); } catch (error) { if (error.status !== 404) throw error; }
  if (head?.meta?.sha256 === hash && Number(head.res.headers['content-length']) === bytes.length) existing++;
  else {
    await putOriginal(image.id, bytes, image.contentType);
    head = await client.head(key);
    if (head.meta?.sha256 !== hash || Number(head.res.headers['content-length']) !== bytes.length) throw new Error(`OSS verification failed: ${image.id}`);
    uploaded++;
  }
  bytesTotal += bytes.length;
  if ((uploaded + existing) % 50 === 0) console.log(JSON.stringify({ checked: uploaded + existing, total: originals.size }));
}
console.log(JSON.stringify({ total: originals.size, uploaded, existing, bytes: bytesTotal }));
db.close();
