import sharp from 'sharp';
import { stat, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const IMAGE_WIDTHS = [480, 960, 1600];
const inflight = new Map();
let active = 0;
const waiting = [];
async function limited(work) {
 if (active >= 2) {
  if (waiting.length >= 32) throw Object.assign(new Error('Image processing busy'), { status: 503 });
  await new Promise(resolve => waiting.push(resolve));
 } else active++;
 try { return await work(); }
 finally { const next = waiting.shift(); if (next) next(); else active--; }
}
export function imageVariantPath(directory, id, width) {
 if (!/^[a-f0-9-]{36}$/.test(id) || !IMAGE_WIDTHS.includes(width)) throw new Error('Invalid image variant');
 return path.join(directory, 'uploads', `image-${id}-w${width}.webp`);
}
export async function imageVariant(directory, id, width) {
 const target = imageVariantPath(directory, id, width);
 if (inflight.has(target)) return inflight.get(target);
 // Register before the first asynchronous filesystem check so deletion observes every admitted request.
 const job = (async () => {
  if (await stat(target).then(s => s.isFile()).catch(() => false)) return target;
  return limited(async () => {
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
   // Preview only the first frame; keep the original animation for the lightbox.
   const bytes = await sharp(path.join(directory, 'uploads', id), { limitInputPixels: 40_000_000, failOn: 'warning' })
    .autoOrient().resize({ width, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toBuffer();
   await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
   await rename(temp, target);
   return target;
  } finally { await unlink(temp).catch(() => {}); }
  });
 })();
 inflight.set(target, job);
 try { return await job; } finally { inflight.delete(target); }
}
export async function prepareImageVariants(directory, id) {
 for (const width of IMAGE_WIDTHS) await imageVariant(directory, id, width);
}
export async function deleteImageFiles(directory, id) {
 const variants = IMAGE_WIDTHS.map(width => imageVariantPath(directory, id, width));
 // Finish already admitted generation before cleanup, so it cannot recreate a deleted file.
 await Promise.allSettled(variants.map(file => inflight.get(file)));
 await Promise.all([path.join(directory, 'uploads', id), ...variants].map(file => unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; })));
}

export async function stopImageQueue() {
 // Requests already admitted can enqueue their next variant after an encode ends.
 while (inflight.size) await Promise.allSettled([...inflight.values()]);
}
