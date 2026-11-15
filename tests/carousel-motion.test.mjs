import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../src/lib/carousel-motion.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { carouselFrame, slideIndex } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const values = frame => [...frame.transform.matchAll(/\((-?[\d.]+)/g)].map(match => Number(match[1]));
test('both streams continuously approach the center, grow and finish at original size', () => {
  for (const sequence of [8,9]) {
    let previousX = Infinity, previousScale = 0;
    for (let p = sequence - 8; p <= sequence; p += .025) {
      const [x, scale] = values(carouselFrame(sequence,p));
      assert.ok(Math.abs(x) <= previousX + 1e-9);
      assert.ok(scale >= previousScale - 1e-9 && scale <= 1);
      previousX = Math.abs(x); previousScale = scale;
    }
    assert.deepEqual(values(carouselFrame(sequence,sequence)), [0,1,0]);
    assert.equal(carouselFrame(sequence,sequence).opacity,1);
    assert.equal(carouselFrame(sequence,sequence+1).opacity,0);
  }
  assert.ok(values(carouselFrame(8,5))[0] < 0);
  assert.ok(values(carouselFrame(9,6))[0] > 0);
});
test('interpolation has no jumps at trajectory knots and ordering wraps in both directions', () => {
  for (const p of [0,2,4,6,8]) {
    const a=values(carouselFrame(8,p-1e-6)), b=values(carouselFrame(8,p+1e-6));
    a.forEach((value,i)=>assert.ok(Math.abs(value-b[i]) < .001));
  }
  assert.deepEqual([0,35,36,37,-1,-37].map(i=>slideIndex(i,36)),[0,35,0,1,35,35]);
});
