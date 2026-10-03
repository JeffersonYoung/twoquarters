import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, open, symlink, link, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { filesystemBytes, managedUsage, storageOverview } from '../server/storage.mjs';

test('filesystem counters distinguish free, available and used with exact arithmetic', () => {
 assert.deepEqual(filesystemBytes({ blocks: 100n, bfree: 30n, bavail: 20n, bsize: 4096n }), { totalBytes: 409600, usedBytes: 286720, availableBytes: 81920, reservedBytes: 40960 });
 for (const disk of [ { blocks: 1n, bfree: 2n, bavail: 1n, bsize: 1n }, { blocks: 2n, bfree: 1n, bavail: -1n, bsize: 1n }, { blocks: 2n**63n, bfree: 1n, bavail: 1n, bsize: 4096n } ]) assert.throws(()=>filesystemBytes(disk));
});

test('managed usage is sparse-aware, deduplicates hardlinks, bounded and never follows symlinks', async () => {
 const dir = await mkdtemp(path.join(tmpdir(),'tq-storage-'));
 try {
  await mkdir(path.join(dir,'uploads'));
  await writeFile(path.join(dir,'portfolio.sqlite'), 'fixture');
  const file = path.join(dir,'uploads','sparse');const handle=await open(file,'w');await handle.truncate(1024**3);await handle.close();
  const before = await managedUsage(dir);assert.ok(before.logicalBytes>=1024**3);assert.ok(before.allocatedBytes<before.logicalBytes);
  await link(file,path.join(dir,'uploads','hardlink'));
  assert.deepEqual(await managedUsage(dir),before);
  assert.equal(await managedUsage(dir,{maxEntries:1}),null);
  assert.equal(await managedUsage(dir,{maxMs:0}),null);
  await symlink('/etc/passwd',path.join(dir,'uploads','symlink'));
  assert.equal(await managedUsage(dir),null);
  await rm(path.join(dir,'uploads','symlink'));
  await mkdir(path.join(dir,'uploads','nested'));
  assert.equal(await managedUsage(dir),null);
  const data=await storageOverview(dir,2);assert.equal(data.managedFiles,null);
  assert.equal(data.video.requiredBytes,1024**3+3*500*1024**2);
  assert.equal(data.video.hasSpaceForNextUpload,data.video.availableBytes>=data.video.requiredBytes);
  await assert.rejects(storageOverview(path.join(dir,'missing'),0));
 } finally { await rm(dir,{recursive:true,force:true}); }
});
