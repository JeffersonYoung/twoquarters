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
test('paired cards move outward symmetrically and grow, then wrap seamlessly',()=>{
 const x=f=>Number(f.transform.match(/ \+ (-?[\d.]+)px/)[1]);
 const scale=f=>Number(f.transform.match(/scale\(([\d.]+)/)[1]);
 let previous=0, previousScale=0;
 for(let t=imageStart;t<imageStart+2200;t+=10){
  const left=frame(0,0,t),right=frame(0,1,t);
  assert.ok(Math.abs(x(left)+x(right))<1e-8);
  assert.ok(Math.abs(x(left))>=previous-1e-8); previous=Math.abs(x(left));
  assert.ok(scale(left)>=previousScale-1e-8); previousScale=scale(left);
  assert.equal(left.opacity,right.opacity);
 }
 const t=imageStart+2200;
 assert.deepEqual(frame(0,0,t),frame(0,0,t+32/(5/6)*1000));
 assert.deepEqual([0,35,36,-1].map(i=>slideIndex(i,36)),[0,35,0,35]);
});
