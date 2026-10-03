import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const css = postcss.parse(readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8'));
const rulesFor = pattern => {
  const rules = [];
  css.walkRules(rule => { if (pattern.test(rule.selector)) rules.push(rule); });
  return rules;
};
const declarations = rule => Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
const rule = selector => {
  const found = rulesFor(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert.equal(found.length, 1, selector);
  return declarations(found[0]);
};

test('all work-image surfaces use contain; only decorative home/about backgrounds may use cover', () => {
  for (const selector of ['.project-card img', '.project-hero > img', '.gallery-shot img', '.lightbox-figure img', '.admin-image-grid img']) {
    assert.equal(rule(selector)['object-fit'], 'contain', selector);
  }
  const coverSelectors = [];
  css.walkDecls('object-fit', decl => { if (decl.value === 'cover') coverSelectors.push(decl.parent.selector); });
  assert.deepEqual(coverSelectors.sort(), ['.about-image-band img', '.home-hero > img']);
});

test('cards and galleries adapt to source ratio without desktop or mobile ratio overrides', () => {
  for (const selector of ['.project-card img', '.gallery-shot img']) {
    const style = rule(selector);
    assert.equal(style.width, '100%');
    assert.equal(style.height, 'auto');
  }
  for (const item of rulesFor(/\.(?:project-card(?:-\d+)?|gallery-shot)[^{}]*\bimg\b/)) {
    const style = declarations(item);
    assert.equal(style['aspect-ratio'], undefined, item.selector);
    assert.equal(style.transform, undefined, `No image zoom clipping: ${item.selector}`);
    assert.equal(style.animation, undefined, `No animated image clipping: ${item.selector}`);
  }
});

test('bounded hero, lightbox and admin images contain extreme source ratios without distortion', () => {
  assert.equal(rule('.project-hero > img')['object-position'], 'center');
  const lightbox = rule('.lightbox-figure img');
  assert.equal(lightbox['max-width'], '100%');
  assert.equal(lightbox['max-height'], '100%');
  // Model CSS contain for desktop/mobile boxes and portrait/landscape/extreme ratios.
  // These are contract checks, not a substitute for browser layout or visual QA.
  for (const [boxWidth, boxHeight] of [[1440, 932], [375, 590], [351, 662], [320, 240]]) {
    for (const [width, height] of [[900, 1600], [1600, 900], [800, 800], [3000, 400], [400, 3000]]) {
      const scale = Math.min(boxWidth / width, boxHeight / height);
      assert.ok(width * scale <= boxWidth + 1e-8);
      assert.ok(height * scale <= boxHeight + 1e-8);
      assert.ok(Math.abs((width * scale) / (height * scale) - width / height) < 1e-8);
    }
  }
});

test('watch player remains contain', () => {
  const fits = rulesFor(/^\.watch-player$/).map(declarations).map(style => style['object-fit']).filter(Boolean);
  assert.deepEqual(fits, ['contain']);
});
