import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createHomeCarousel } from '../server/home-carousel.mjs';

test('homepage images stay private until enabled; ordered changes persist and deletion revokes cached access',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'tq-carousel-'));await mkdir(path.join(directory,'uploads'));
 try{
  let carousel=await createHomeCarousel(directory);
  const image=await sharp({create:{width:1800,height:1000,channels:3,background:'orange'}}).jpeg().toBuffer();
  const first=await carousel.upload(image,'first.jpg'),second=await carousel.upload(image,'second.jpg');
  assert.equal(carousel.snapshot().slides.length,0);assert.equal(second.slides.length,2);
  assert.equal(carousel.find(first.slides[0].variants[0].id),undefined);
  assert.ok(carousel.find(first.slides[0].variants[0].id,true));
  await assert.rejects(carousel.update({...first,slides:first.slides.map(s=>({...s,enabled:true}))}),e=>e.status===409);
  const enabled=await carousel.update({...second,interval:3,slides:[...second.slides].reverse().map(s=>({...s,enabled:true}))});
  const uri=enabled.slides[0].variants[0].src;
  assert.ok(carousel.allows(uri,'GET'));assert.ok(carousel.allows(uri,'HEAD'));
  for(const method of ['POST','DELETE',undefined])assert.equal(carousel.allows(uri,method),false);
  assert.equal(carousel.allows(uri+'?width=480','GET'),false);
  carousel=await createHomeCarousel(directory);assert.deepEqual(carousel.snapshot(),enabled);
  for(const v of enabled.slides[0].variants){const meta=await sharp(await readFile(path.join(directory,'uploads',v.id))).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,v.width);assert.ok(meta.width<=1800);}
  await assert.rejects(carousel.update({...enabled,interval:2}),e=>e.status===400);
  await assert.rejects(carousel.update({...enabled,slides:[enabled.slides[0],enabled.slides[0]]}),e=>e.status===400);
  const hidden=await carousel.update({...enabled,slides:enabled.slides.map(s=>({...s,enabled:false}))});
  assert.equal(carousel.allows(uri,'GET'),false);
  let current=hidden;
  for(const slide of hidden.slides)current=await carousel.remove(slide.id,current.revision);
  assert.deepEqual(await readdir(path.join(directory,'uploads')),[]);
  assert.equal((await createHomeCarousel(directory)).snapshot().slides.length,0);
  await assert.rejects(carousel.upload(Buffer.from('not an image'),'bad.jpg'),e=>e.status===400);
 }finally{await rm(directory,{recursive:true,force:true});}
});
