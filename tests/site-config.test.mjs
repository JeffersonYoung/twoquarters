import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { publicSiteConfig, loadSiteConfig } from '../server/site-config.mjs';
const empty = { filingItems: [], socialLinks: [] };
const fixture = {
  password: 'must-not-leak', configPath: '/private/path',
  filing: {
    icp: { number: '测试 ICP（非真实备案）', url: 'https://beian.miit.gov.cn/', secret: 'hidden' },
    publicSecurity: { number: '测试公安（非真实备案）', url: 'https://beian.mps.gov.cn/' },
    other: [{ label: '其他备案', url: '' }, { label: '' }],
  },
  socialLinks: [{ label: '小红书', url: 'https://example.com/profile' }, { label: '', url: '' }],
};
test('configuration exposes only bounded public filing/social entries', () => {
  assert.deepEqual(publicSiteConfig({}), empty);
  const result = publicSiteConfig(fixture);
  assert.equal(result.filingItems.length, 3); assert.equal(result.socialLinks.length, 1);
  assert.deepEqual(result.filingItems[2], { label: '其他备案' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(result).includes('/private/path'), false);
  assert.deepEqual(publicSiteConfig({ socialLinks: [{ label: 'No URL' }] }), empty);
});
test('rejects malformed data and unsafe or ambiguous URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//evil.example', '/path', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com/\nfoo', 'https:\\example.com', 'https:///example.com', 'https://', 'https://exa mple.com']) {
    // Triple slash can be normalized by WHATWG URL; forbid it explicitly below.
    assert.throws(() => publicSiteConfig({ filing: { icp: { number: 'test', url } } }), /Invalid/);
    assert.throws(() => publicSiteConfig({ socialLinks: [{ label: 'test', url }] }), /Invalid/);
  }
  for (const value of [null, [], { filing: [] }, { filing: { other: {} } }, { filing: { icp: { number: 42 } } }, { socialLinks: Array(21).fill({}) }, { socialLinks: [{ label: 'x'.repeat(201) }] }]) assert.throws(() => publicSiteConfig(value));
});
test('loads optional runtime JSON with size/type limits and generic errors', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tq-config-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'site.json');
  assert.deepEqual(await loadSiteConfig(''), empty);
  await writeFile(file, JSON.stringify(fixture)); assert.deepEqual(await loadSiteConfig(file), publicSiteConfig(fixture));
  for (const content of ['{', ' '.repeat(65537), '{"filing":false}']) {
    await writeFile(file, content);
    await assert.rejects(loadSiteConfig(file), error => !error.message.includes(dir) && /Cannot load/.test(error.message));
  }
  await assert.rejects(loadSiteConfig(dir)); await assert.rejects(loadSiteConfig(path.join(dir, 'missing')));
});
const source = await readFile(new URL('../src/lib/site-config.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const client = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('frontend defensive parsing and same-origin graceful failure', async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  const signal = new AbortController().signal;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/site-config'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.signal, signal);
    return Response.json(publicSiteConfig(fixture));
  };
  assert.deepEqual(await client.getSiteConfig(signal), publicSiteConfig(fixture));
  for (const response of [() => { throw new Error('offline'); }, () => new Response('oops', { status: 500 }), () => new Response('not json'), () => Response.json({ filingItems: null })]) {
    globalThis.fetch = async () => response(); assert.deepEqual(await client.getSiteConfig(), empty);
  }
  for (const url of ['javascript:alert(1)', '//evil.example', 'https://a:b@example.com', 'https://example.com/\nfoo', 'https:///example.com']) {
    assert.deepEqual(client.parseFilingItems({ filingItems: [{ label: '<script>literal</script>', url }] }), [{ label: '<script>literal</script>' }]);
  }
});

test('React footer renders escaped text, safe external links and hides empty rows', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const source = await readFile(new URL('../src/components/FooterLinks.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(require, exports);
  for (const Component of [exports.FilingLinks, exports.SocialLinks]) {
    assert.equal(renderToStaticMarkup(React.createElement(Component, { items: [], isEnglish: false })), '');
    const html = renderToStaticMarkup(React.createElement(Component, { items: [{ label: '<script>test</script>', url: 'https://example.com/?a=1&b=2' }], isEnglish: true }));
    assert.ok(html.includes('&lt;script&gt;test&lt;/script&gt;'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
    assert.ok(html.includes('https://example.com/?a=1&amp;b=2'));
    assert.ok(html.includes('aria-label='));
  }
  const html = renderToStaticMarkup(React.createElement(exports.FilingLinks, { items: [{ label: '其他备案' }], isEnglish: false }));
  assert.ok(html.includes('<span>其他备案</span>')); assert.ok(!html.includes('<a '));
});
