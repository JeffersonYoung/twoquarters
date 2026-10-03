import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = fileURLToPath(new URL('../src/', import.meta.url));
const upload = '/api/images/01234567-89ab-4cde-8fab-0123456789ab';
const images = Array.from({ length: 5 }, (_, index) => ({
  id: `01234567-89ab-4cde-8fab-0123456789a${index}`,
  src: `/api/images/01234567-89ab-4cde-8fab-0123456789a${index}`,
  alt: `Image ${index}`,
  width: 2400,
  height: 1600,
}));
const project = {
  id: 'fixture', slug: 'fixture', title: 'Fixture', titleEn: 'Fixture',
  category: 'automotive', year: '2026', discipline: 'Photography', summary: '',
  cover: images[0], images, videos: [], credits: '', published: false,
};

// Follow the repository's transpile-and-render convention without adding a test
// framework. Only browser state/context is stubbed; actual image markup is rendered.
function loadSource(entry, { admin = false } = {}) {
  const cache = new Map();
  const stubs = new Map([
    [path.join(root, 'router'), {
      Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
      Navigate: () => null,
      useParams: () => ({ slug: project.slug }),
    }],
    [path.join(root, 'ProjectsContext'), {
      useProjects: () => ({ projects: [project], loading: false, refresh: async () => {} }),
    }],
    [path.join(root, 'components/Reveal'), {
      Reveal: ({ children, className }) => React.createElement('div', { className }, children),
    }],
  ]);
  const adminReact = { ...React, useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial;
    if (value === 'checking') return React.useState('authenticated');
    if (Array.isArray(value)) return React.useState([project]);
    if (value && typeof value === 'object' && 'selectedSlug' in value) {
      const draft = { ...project };
      return React.useState({ selectedSlug: project.slug, draft, savedDraft: draft, creating: false });
    }
    return React.useState(value);
  } };

  function load(filename) {
    if (stubs.has(filename)) return stubs.get(filename);
    if (!path.extname(filename)) filename += existsSync(`${filename}.tsx`) ? '.tsx' : '.ts';
    if (cache.has(filename)) return cache.get(filename);
    const source = readFileSync(filename, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const exports = {};
    cache.set(filename, exports);
    const localRequire = specifier => {
      if (specifier.startsWith('.')) return load(path.resolve(path.dirname(filename), specifier));
      if (admin && specifier === 'react' && filename === path.join(root, 'pages/AdminPage.tsx')) return adminReact;
      return require(specifier);
    };
    new Function('require', 'exports', code)(localRequire, exports);
    return exports;
  }
  return load(path.join(root, entry));
}

const helper = loadSource('lib/images.ts');
const imgTags = markup => [...markup.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
const attr = (tag, name) => tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i'))?.[1];
const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));

test('local uploaded images receive bounded responsive URLs with a resized fallback', () => {
  assert.equal(helper.imageVariant(upload, 480), `${upload}?width=480`);
  assert.deepEqual(helper.responsiveImage(upload, [480, 960], '50vw'), {
    src: `${upload}?width=480`,
    srcSet: `${upload}?width=480 480w, ${upload}?width=960 960w`,
    sizes: '50vw',
  });
  assert.deepEqual(helper.responsiveImage(upload, [960, 1600], '100vw'), {
    src: `${upload}?width=960`,
    srcSet: `${upload}?width=960 960w, ${upload}?width=1600 1600w`,
    sizes: '100vw',
  });
});

test('only the two known decorative assets receive static WebP variants', () => {
  for (const source of [
    '/images/automotive/hero-mclaren.jpg',
    '/images/bts/francesco-ungaro-P45gR9kH0SM-unsplash.jpg',
  ]) {
    const result = helper.responsiveImage(source, [480, 960, 1600], '100vw');
    assert.equal(result.src, source.replace('.jpg', '-480.webp'));
    assert.equal(result.srcSet, [480, 960, 1600].map(width => `${source.replace('.jpg', `-${width}.webp`)} ${width}w`).join(', '));
  }
});

test('known original dimensions clamp srcset descriptors and omit duplicate non-upscaled variants', () => {
  assert.deepEqual(helper.responsiveImage(upload, [480, 960, 1600], '100vw', 800), {
    src: `${upload}?width=480`,
    srcSet: `${upload}?width=480 480w, ${upload}?width=960 800w`,
    sizes: '100vw',
  });
  for (const width of [8, 480]) {
    assert.deepEqual(helper.responsiveImage(upload, [480, 960], '100vw', width), { src: `${upload}?width=480` });
  }
  assert.deepEqual(helper.responsiveImage(upload, [960, 1600], '100vw', 800), { src: `${upload}?width=960` });
  for (const width of [undefined, 0, -1, NaN, Infinity]) {
    assert.equal(helper.responsiveImage(upload, [480, 960], '100vw', width).srcSet,
      `${upload}?width=480 480w, ${upload}?width=960 960w`);
  }
});

test('external, malformed, blob/data and unrelated static sources remain unchanged', () => {
  for (const source of [
    `https://external.example${upload}`, `//external.example${upload}`, `https://portfolio.example${upload}`,
    '/images/unrelated.jpg', '/images/automotive/hero-mclaren.jpg?v=2',
    '/api/images/not-a-uuid', '/api/images/../../private', `${upload}/extra`,
    `${upload}?download=1`, `${upload}#original`, `/prefix${upload}`,
    'blob:https://portfolio.example/image', 'data:image/png;base64,AAAA', '',
  ]) {
    assert.equal(helper.imageVariant(source, 480), source);
    assert.deepEqual(helper.responsiveImage(source, [480, 960], '100vw'), { src: source });
  }
});

test('responsive sizes match card/gallery CSS column spans, gaps and mobile gutters', () => {
  const cardSizes = [
    'calc(58.3333vw - 42.6667px)', 'calc(33.3333vw - 34.6667px)',
    'calc(33.3333vw - 34.6667px)', 'calc(50vw - 40px)',
  ];
  const gallerySizes = [
    'calc(100vw - 56px)', 'calc(66.6667vw - 45.3333px)', 'calc(58.3333vw - 42.6667px)',
    'calc(66.6667vw - 45.3333px)', 'calc(58.3333vw - 42.6667px)',
  ];
  for (let index = 0; index < 12; index++) {
    assert.equal(helper.projectCardSizes(index), `(max-width: 640px) calc(100vw - 32px), ${cardSizes[index % 4]}`);
    assert.equal(helper.projectGallerySizes(index), `(max-width: 640px) calc(100vw - 32px), ${gallerySizes[index % 5]}`);
  }
});

test('cards render 480/960 responsive sources, async decoding and below-fold lazy loading', () => {
  const { ProjectCard } = loadSource('components/ProjectCard.tsx');
  for (let index = 0; index < 4; index++) {
    const [img] = imgTags(render(ProjectCard, { project, index }));
    assert.equal(attr(img, 'src'), `${project.cover.src}?width=480`);
    assert.equal(attr(img, 'srcSet'), `${project.cover.src}?width=480 480w, ${project.cover.src}?width=960 960w`);
    assert.equal(attr(img, 'sizes'), helper.projectCardSizes(index));
    assert.equal(attr(img, 'loading'), index > 1 ? 'lazy' : 'eager');
    assert.equal(attr(img, 'decoding'), 'async');
  }
  const [img] = imgTags(render(ProjectCard, { project: { ...project, cover: { src: '/legacy.jpg', alt: 'Legacy' } } }));
  assert.equal(attr(img, 'src'), '/legacy.jpg');
  assert.equal(attr(img, 'srcSet'), undefined);
});

test('detail hero is prioritized; gallery is lazy, responsive and reserves known dimensions', () => {
  const { ProjectPage } = loadSource('pages/ProjectPage.tsx');
  const [hero, ...gallery] = imgTags(render(ProjectPage));
  assert.equal(attr(hero, 'src'), `${project.cover.src}?width=960`);
  assert.equal(attr(hero, 'srcSet'), `${project.cover.src}?width=960 960w, ${project.cover.src}?width=1600 1600w`);
  assert.equal(attr(hero, 'sizes'), '100vw');
  assert.equal(attr(hero, 'loading'), 'eager');
  assert.equal(attr(hero, 'fetchPriority'), 'high');
  assert.equal(gallery.length, images.length);
  gallery.forEach((img, index) => {
    assert.equal(attr(img, 'src'), `${images[index].src}?width=960`);
    assert.equal(attr(img, 'srcSet'), `${images[index].src}?width=960 960w, ${images[index].src}?width=1600 1600w`);
    assert.equal(attr(img, 'sizes'), helper.projectGallerySizes(index));
    assert.equal(attr(img, 'loading'), 'lazy');
    assert.equal(attr(img, 'decoding'), 'async');
    assert.equal(attr(img, 'width'), '2400');
    assert.equal(attr(img, 'height'), '1600');
  });
});

test('lightbox renders only the selected original, without preloading other originals', () => {
  const { Lightbox } = loadSource('components/Lightbox.tsx');
  for (const index of [0, 3]) {
    const markup = render(Lightbox, { images, index, onChange() {}, onClose() {} });
    const tags = imgTags(markup);
    assert.equal(tags.length, 1);
    assert.equal(attr(tags[0], 'src'), images[index].src);
    assert.equal(attr(tags[0], 'srcSet'), undefined);
    assert.ok(!markup.includes('rel="preload"'));
    images.forEach((image, other) => { if (other !== index) assert.ok(!markup.includes(image.src)); });
  }
});

test('Home prioritizes the responsive static hero and defers all featured cards; About defers its image', () => {
  const { HomePage } = loadSource('pages/HomePage.tsx');
  const [hero, ...cards] = imgTags(render(HomePage));
  assert.equal(attr(hero, 'src'), '/images/automotive/hero-mclaren-480.webp');
  assert.equal(attr(hero, 'sizes'), '100vw');
  assert.equal(attr(hero, 'loading'), 'eager');
  assert.equal(attr(hero, 'fetchPriority'), 'high');
  assert.ok(attr(hero, 'srcSet').includes('-1600.webp 1600w'));
  assert.ok(cards.length > 0);
  for (const card of cards) assert.equal(attr(card, 'loading'), 'lazy');
  const { AboutPage } = loadSource('pages/AboutPage.tsx');
  const [about] = imgTags(render(AboutPage));
  assert.equal(attr(about, 'src'), '/images/bts/francesco-ungaro-P45gR9kH0SM-unsplash-480.webp');
  assert.equal(attr(about, 'loading'), 'lazy');
  assert.equal(attr(about, 'sizes'), '100vw');
  assert.ok(attr(about, 'srcSet').includes('-1600.webp 1600w'));
});

test('authenticated admin previews request only 480px thumbnails and load lazily', () => {
  const { AdminPage } = loadSource('pages/AdminPage.tsx', { admin: true });
  const tags = imgTags(render(AdminPage));
  assert.equal(tags.length, images.length);
  tags.forEach((img, index) => {
    assert.equal(attr(img, 'src'), `${images[index].src}?width=480`);
    assert.equal(attr(img, 'srcSet'), undefined);
    assert.equal(attr(img, 'loading'), 'lazy');
    assert.equal(attr(img, 'decoding'), 'async');
  });
});
