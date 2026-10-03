import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { imageVariant, prepareImageVariants, deleteImageFiles } from '../server/images.mjs';

test('bounded cached variants preserve source, orientation and smaller dimensions/bytes; cleanup is complete', async () => {
 const dir=await mkdtemp(path.join(tmpdir(),'tq-images-')),id=randomUUID();await mkdir(path.join(dir,'uploads'));
 try {
  const source=await readFile('server/seed-images/automotive/hero-mclaren.jpg');
  await writeFile(path.join(dir,'uploads',id),source);
  const targets=await Promise.all(Array.from({length:8},()=>imageVariant(dir,id,480)));
  assert.equal(new Set(targets).size,1);assert.equal((await readdir(path.join(dir,'uploads'))).length,2);
  const bytes=await readFile(targets[0]),meta=await sharp(bytes).metadata(),original=await sharp(source).metadata();
  assert.equal(meta.width,480);assert.ok(meta.height<original.height);assert.ok(bytes.length<source.length/2);
  assert.equal((await stat(targets[0])).mode&0o777,0o600);
  const modified=(await stat(targets[0])).mtimeMs;await imageVariant(dir,id,480);assert.equal((await stat(targets[0])).mtimeMs,modified);
  await prepareImageVariants(dir,id);assert.equal((await readdir(path.join(dir,'uploads'))).length,4);
  assert.deepEqual(await readFile(path.join(dir,'uploads',id)),source);
  await assert.rejects(imageVariant(dir,id,123),/Invalid image variant/);
  await deleteImageFiles(dir,id);assert.deepEqual(await readdir(path.join(dir,'uploads')),[]);
  const rotated=await sharp({create:{width:24,height:16,channels:3,background:'red'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  await writeFile(path.join(dir,'uploads',id),rotated);
  const upright=await sharp(await imageVariant(dir,id,960)).metadata();assert.equal(upright.width,16);assert.equal(upright.height,24);assert.equal(upright.orientation,undefined);
  await deleteImageFiles(dir,id);
 } finally { await rm(dir,{recursive:true,force:true}); }
});

test('deleting an image while a variant is generating does not leave derivatives', async () => {
 const dir=await mkdtemp(path.join(tmpdir(),'tq-image-delete-')),id=randomUUID();await mkdir(path.join(dir,'uploads'));
 try {
  await writeFile(path.join(dir,'uploads',id),await readFile('server/seed-images/automotive/hero-mclaren.jpg'));
  const job=imageVariant(dir,id,480);
  const second=imageVariant(dir,id,1600);
  await deleteImageFiles(dir,id);
  await Promise.allSettled([job,second]);
  assert.deepEqual(await readdir(path.join(dir,'uploads')),[]);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
