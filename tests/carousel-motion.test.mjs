import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../src/lib/carousel-motion.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { carouselFrame, getStreamPosition, apertureOpen, slideIndex } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const frame=(pair,side,time)=>carouselFrame(pair,side,time,1920,1080,240,108);
const imageStart=180+720*(1-Math.cbrt(.2));
test('reference opening and initial fill preserve timing',()=>{
 assert.equal(apertureOpen(180),0); assert.equal(apertureOpen(900),1);
 assert.equal(frame(0,0,0).opacity,0);
 assert.ok(Math.abs(getStreamPosition(imageStart+1000)-6)<1e-10);
 assert.ok(Math.abs(getStreamPosition(imageStart+2200)-7)<1e-10);
});
test('both sides approach the center and grow, then fade and repeat',()=>{
 const x=f=>Number(f.transform.match(/ \+ (-?[\d.]+)px/)[1]);
 const scale=f=>Number(f.transform.match(/scale\(([\d.]+)/)[1]);
 for(const side of [0,1]) {
  let previous=Infinity, previousScale=0;
  for(let t=imageStart;t<imageStart+3000;t+=10){
   const card=frame(0,side,t);
   assert.ok(Math.abs(x(card))<=previous+1e-8);previous=Math.abs(x(card));
   assert.ok(scale(card)>=previousScale-1e-8);previousScale=scale(card);
  }
  const t=imageStart+1600+side*600;
  assert.equal(x(frame(0,side,t)),0);
  assert.equal(frame(0,side,imageStart+4000).opacity,0);
  const a=frame(0,side,t),b=frame(0,side,t+32/(5/6)*1000);
  assert.equal(a.transform,b.transform); assert.ok(Math.abs(a.opacity-b.opacity)<1e-10);
 }
 assert.deepEqual([0,35,36,-1].map(i=>slideIndex(i,36)),[0,35,0,35]);
});
