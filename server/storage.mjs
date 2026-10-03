import { lstat, opendir, statfs } from 'node:fs/promises';
import path from 'node:path';

export const VIDEO_DISK_RESERVE = 1024 ** 3;
export const MAX_VIDEO_BYTES = 250 * 1024 ** 2;

// BigInt arithmetic avoids overflowing intermediate products. JSON/UI only accepts
// exact safe integers; unsupported filesystem counters fail rather than show zero.
export function filesystemBytes(disk) {
 const { blocks, bfree, bavail, bsize } = disk;
 if ([blocks,bfree,bavail,bsize].some(n => typeof n !== 'bigint' || n < 0n) || bsize === 0n || bfree > blocks || bavail > bfree) throw new Error('Invalid filesystem counters');
 const exact = n => { if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Filesystem too large'); return Number(n); };
 return { totalBytes: exact(blocks*bsize), usedBytes: exact((blocks-bfree)*bsize), availableBytes: exact(bavail*bsize), reservedBytes: exact((bfree-bavail)*bsize) };
}

// Only the app's flat upload directory and SQLite files are counted. Never follow
// entries, recurse into arbitrary directories, or read file contents. Bound work;
// incomplete/error/racing scans are unavailable, never a misleading partial total.
export async function managedUsage(directory, { maxEntries = 10000, maxMs = 250 } = {}) {
 const deadline = performance.now() + maxMs;
 let count = 0, allocated = 0, logical = 0;
 const seen = new Set();
 async function add(file, optional = false) {
  if (++count > maxEntries || performance.now() > deadline) throw new Error('Scan limit');
  let s;
  try { s = await lstat(file, { bigint: true }); } catch (e) { if (optional && e.code === 'ENOENT') return; throw e; }
  if (!s.isFile()) throw new Error('Unexpected managed entry');
  const key = `${s.dev}:${s.ino}`;
  if (seen.has(key)) return;
  seen.add(key);
  allocated += Number(s.blocks * 512n); logical += Number(s.size);
  if (!Number.isSafeInteger(allocated) || !Number.isSafeInteger(logical)) throw new Error('Usage too large');
 }
 try {
  for (const name of ['portfolio.sqlite','portfolio.sqlite-wal','portfolio.sqlite-shm']) await add(path.join(directory,name),true);
  const uploads = path.join(directory,'uploads');
  if (!(await lstat(uploads)).isDirectory()) throw new Error('Unexpected uploads directory');
  const entries = await opendir(uploads);
  for await (const entry of entries) await add(path.join(uploads,entry.name));
  if (performance.now() > deadline) throw new Error('Scan limit');
  return { allocatedBytes: allocated, logicalBytes: logical };
 } catch { return null; }
}

export async function storageOverview(directory, activeJobs) {
 const filesystem = filesystemBytes(await statfs(directory, { bigint: true }));
 // Uploads may be a separate mount. The admission check uses that filesystem.
 const uploadDisk = filesystemBytes(await statfs(path.join(directory,'uploads'), { bigint: true }));
 const requiredBytes = VIDEO_DISK_RESERVE + (activeJobs + 1) * 2 * MAX_VIDEO_BYTES;
 return {
  sampledAt: new Date().toISOString(), filesystem,
  managedFiles: await managedUsage(directory),
  video: { reserveBytes: VIDEO_DISK_RESERVE, maxFileBytes: MAX_VIDEO_BYTES, activeJobs, requiredBytes, availableBytes: uploadDisk.availableBytes, hasSpaceForNextUpload: uploadDisk.availableBytes >= requiredBytes },
 };
}
