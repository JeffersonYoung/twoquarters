import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, access, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'twoquarters-ui-'));
const port = Number(process.env.UI_TEST_PORT || 3100);
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'test', DATA_DIR: directory, SITE_CONFIG_FILE: path.join(directory, 'site.json'), APP_ORIGIN: origin, PORT: String(port), HOST: '127.0.0.1' };
const password = randomBytes(24).toString('hex');
const runFixture = (script, input) => execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env, input, stdio: ['pipe', 'pipe', 'pipe'] });
runFixture(`import {hashPassword} from './server/auth.mjs'; import {db} from './server/store.mjs'; let password=''; for await(const chunk of process.stdin) password+=chunk; db.prepare('INSERT INTO users VALUES(?,?)').run('ui-test',await hashPassword(password)); db.close();`, password);
await writeFile(env.SITE_CONFIG_FILE, JSON.stringify({
  secret: 'not-public',
  filing: { icp: { number: '测试 ICP（非真实备案）', url: 'https://example.com/icp' }, publicSecurity: { number: '测试公安（非真实备案）', url: 'https://example.com/police' }, other: [{ label: '<script>literal text</script>' }, { label: '' }] },
  socialLinks: [{ label: '小红书', url: 'https://example.com/profile' }, { label: 'Custom social', url: 'https://example.com/custom' }],
}));
const server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });
let browser;
const artifacts = process.env.UI_TEST_ARTIFACTS;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server failed: ${output}`);
    try { if ((await fetch(`${origin}/api/session`)).ok) break; } catch { /* wait for server */ }
    if (attempt === 99) throw new Error(`Test server timed out: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const systemChromium = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
  const executablePath = await access(systemChromium).then(() => systemChromium).catch(() => undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [], external = new Set(), mutations = [];
  context.on('page', child => child.on('pageerror', error => errors.push(error.message)));
  page.on('pageerror', error => errors.push(error.message));
  context.on('request', request => {
    if (!request.url().startsWith(origin)) external.add(request.url());
    if (request.url().includes('/api/') && request.method() !== 'GET') mutations.push({ url: request.url(), method: request.method(), csrf: request.headers()['x-csrf-token'] });
  });
  const visible = selector => page.locator(selector).waitFor({ state: 'visible' });
  const count = async (selector, expected) => {
    await page.waitForFunction(({ selector, expected }) => document.querySelectorAll(selector).length === expected, { selector, expected });
  };
  const ready = () => page.waitForFunction(() => document.querySelector('.primary-button') && !document.querySelector('.primary-button').disabled);
  const fillLogin = async (secret = password) => {
    await page.getByLabel('用户名', { exact: true }).fill('ui-test');
    await page.getByLabel('密码', { exact: true }).fill(secret);
    await page.getByRole('button', { name: '登录', exact: true }).click();
  };

  await page.goto(`${origin}/works`);
  await count('.works-grid .project-card', 6);
  await count('.footer-filings li', 3);
  await count('.footer-socials a', 2);
  assert.equal(await page.locator('.footer-filings script').count(), 0);
  assert.equal(await page.locator('.footer-filings li').last().textContent(), '<script>literal text</script>');
  for (const link of await page.locator('.footer-filings a, .footer-socials a').all()) {
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.site-footer').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  if (artifacts) { await mkdir(artifacts, { recursive: true }); await page.screenshot({ path: path.join(artifacts, 'footer-mobile.png') }); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (artifacts) await page.locator('.site-footer').screenshot({ path: path.join(artifacts, 'footer-desktop.png') });
  await page.goto(`${origin}/en`);
  await page.getByRole('navigation', { name: 'Social media' }).waitFor();
  await page.getByRole('list', { name: 'Site registration' }).waitFor();
  await page.route('**/api/site-config', route => route.fulfill({ status: 500, body: 'unavailable' }));
  await page.goto(`${origin}/works`);
  await count('.works-grid .project-card', 6);
  assert.equal(await page.locator('.footer-filings, .footer-socials').count(), 0);
  await page.unroute('**/api/site-config');
  await page.route('**/api/site-config', route => route.fulfill({ contentType: 'application/json', body: '{"filingItems":[],"socialLinks":[]}' }));
  await page.reload();
  await count('.works-grid .project-card', 6);
  assert.equal(await page.locator('.footer-filings, .footer-socials').count(), 0);
  await page.unroute('**/api/site-config');
  await page.reload();
  await count('.footer-filings li', 3);
  assert.deepEqual(await page.locator('.filter-tabs button').evaluateAll(buttons => buttons.map(button => button.childNodes[0].textContent)), ['全部','汽车','CG&AI','快消','视频','幕后影像']);
  await page.getByRole('tab', { name: '快消' }).click();
  await count('.works-grid .project-card', 1);
  await page.getByRole('tab', { name: '全部' }).click();
  await count('.works-grid .project-card', 6);
  await page.locator('.works-grid .project-card a').first().click();
  await visible('.project-hero');
  await page.locator('.project-gallery button').first().click();
  await visible('.lightbox');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await page.locator('.lightbox').waitFor({ state: 'detached' });
  await page.goBack();
  await count('.works-grid .project-card', 6);

  await page.goto(`${origin}/admin`);
  await fillLogin('invalid-test-password');
  await visible('.admin-error');
  assert.match(await page.locator('.admin-error').textContent(), /密码|登录/);
  await fillLogin();
  await count('.admin-sidebar nav button', 6);
  await ready();
  await page.locator('.storage-stats').waitFor();
  assert.equal(await page.locator('.storage-stats dd').count(),4);
  assert.deepEqual(await page.getByLabel('分类', { exact: true }).locator('option').allTextContents(), ['汽车','CG&AI','快消','视频','幕后影像']);
  await page.getByLabel('中文标题', { exact: true }).fill('存储刷新保留草稿');
  await page.route('**/api/admin/storage', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"fixture"}' }));
  await page.getByRole('button', { name: '刷新空间', exact: true }).click();
  await page.locator('.storage-overview [role=alert]').waitFor();
  assert.equal(await page.locator('.storage-stats').count(),0);
  assert.equal(await page.getByLabel('中文标题', { exact: true }).inputValue(),'存储刷新保留草稿');
  await page.unroute('**/api/admin/storage');
  await page.getByRole('button', { name: '刷新空间', exact: true }).click();
  await page.locator('.storage-stats').waitFor();
  // Restore the saved title before the reload flow to avoid an unsaved-change prompt.
  await page.getByLabel('中文标题', { exact: true }).fill(await page.locator('.workspace-heading h1').textContent());
  const cookie = (await context.cookies()).find(item => item.name === 'tq_session');
  assert.equal(cookie?.httpOnly, true);
  assert.equal(cookie?.sameSite, 'Strict');
  await page.reload();
  await ready();
  await page.getByLabel('中文标题', { exact: true }).fill('unsaved fixture edit');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.admin-sidebar nav button').nth(1).click();
  assert.equal(await page.getByLabel('中文标题', { exact: true }).inputValue(), 'unsaved fixture edit');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.admin-sidebar nav button').nth(1).click();
  assert.notEqual(await page.getByLabel('中文标题', { exact: true }).inputValue(), 'unsaved fixture edit');

  await page.getByRole('button', { name: '新建项目' }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '创建并继续' }).count(), 0);
  await page.getByRole('button', { name: '新建项目' }).click();
  await page.getByLabel('中文标题', { exact: true }).fill('UI 测试项目');
  await page.getByLabel('英文标题', { exact: true }).fill('UI Test Project');
  await page.locator('.project-editor').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await count('.admin-sidebar nav button', 7);
  await ready();
  assert.equal(mutations.filter(item => item.url === `${origin}/api/admin/projects` && item.method === 'POST').length, 1);
  const slug = await page.locator('.workspace-heading > div > span').textContent();
  assert.ok(slug.startsWith('ui-test-project-'));
  await page.getByLabel('中文标题', { exact: true }).fill('图片上传期间的未保存资料');
  await page.locator('.image-manager input[type=file]').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await visible('.admin-notice.is-error');
  await page.locator('.image-manager input[type=file]').setInputFiles([
    path.join(root, 'server/seed-images/bts/vitalik-vynarchyk-TUzsO59UFpo-unsplash.jpg'),
    path.join(root, 'server/seed-images/fashion/mina-rad-V94CguEmeos-unsplash.jpg'),
  ]);
  await count('.admin-image-grid article', 2);
  await ready();
  assert.equal(await page.getByLabel('中文标题', { exact: true }).inputValue(), '图片上传期间的未保存资料');
  await page.locator('.admin-image-grid article').nth(1).getByTitle('设为封面').click();
  await ready();
  assert.equal(await page.locator('.admin-image-grid article').nth(1).locator('.image-card-info em').count(), 1);
  const videoFixture = path.join(directory, 'fixture.mp4');
  execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=12','-t','1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',videoFixture]);
  await page.locator('.video-manager input[type=file]').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await visible('.admin-notice.is-error');
  await page.locator('.video-manager input[type=file]').setInputFiles(videoFixture);
  await count('.admin-video-grid article', 1);
  await ready();
  await page.getByLabel('中文标题', { exact: true }).fill('视频处理期间保留的资料');
  await page.locator('.admin-video-grid video').waitFor({ state: 'visible', timeout: 60000 });
  assert.equal(await page.getByLabel('中文标题', { exact: true }).inputValue(), '视频处理期间保留的资料');
  const videoSrc = await page.locator('.admin-video-grid video').getAttribute('src');
  assert.equal((await fetch(origin + videoSrc)).status, 404, 'anonymous draft video must stay private');
  await page.getByLabel('中文标题', { exact: true }).fill('UI 测试已发布');
  await page.getByLabel('允许在公开网站展示').check();
  await page.getByRole('button', { name: '保存资料' }).click();
  await ready();
  assert.equal((await (await context.request.get(`${origin}/api/projects`)).json()).length, 7);
  const publicPage = await context.newPage();
  await publicPage.goto(`${origin}/works/${slug}`);
  await publicPage.getByRole('heading', { name: 'UI 测试已发布', exact: true }).waitFor();
  await publicPage.locator('.project-videos video').waitFor();
  assert.equal((await fetch(origin + videoSrc)).status, 200);
  await publicPage.waitForFunction(() => document.querySelector('.project-videos video')?.readyState >= 1);
  await publicPage.locator('.project-gallery button').first().click();
  await publicPage.getByRole('dialog').waitFor();
  await publicPage.keyboard.press('Escape');
  await publicPage.close();

  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'admin-desktop.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开项目列表' }).click();
  await visible('.admin-sidebar.is-open');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.admin-sidebar.is-open').count(), 0);
  await page.getByRole('button', { name: '打开项目列表' }).click();
  await page.locator('.admin-sidebar-backdrop').click({ position: { x: 370, y: 200 } });
  assert.equal(await page.locator('.admin-sidebar.is-open').count(), 0);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, 'admin-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByLabel('允许在公开网站展示').uncheck();
  await page.getByRole('button', { name: '保存资料' }).click();
  await ready();
  assert.equal((await (await context.request.get(`${origin}/api/projects`)).json()).length, 6);
  assert.equal((await fetch(origin + videoSrc)).status, 404);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.admin-video-grid button').click();
  await count('.admin-video-grid article', 1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.admin-video-grid button').click();
  await count('.admin-video-grid article', 0);
  await ready();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.admin-image-grid article').first().getByTitle('删除图片').click();
  await count('.admin-image-grid article', 2);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.admin-image-grid article').first().getByTitle('删除图片').click();
  await count('.admin-image-grid article', 1);
  await ready();

  await page.getByLabel('中文标题', { exact: true }).fill('登录过期后保留的资料');
  runFixture(`import {db} from './server/store.mjs'; db.prepare('DELETE FROM sessions').run(); db.close();`);
  await page.getByRole('button', { name: '保存资料' }).click();
  await visible('.admin-login');
  await fillLogin();
  await ready();
  assert.equal(await page.getByLabel('中文标题', { exact: true }).inputValue(), '登录过期后保留的资料');
  await page.getByRole('button', { name: '保存资料' }).click();
  await ready();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await count('.admin-sidebar nav button', 7);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await count('.admin-sidebar nav button', 6);
  await ready();
  assert.notEqual(await page.locator('.workspace-heading > div > span').textContent(), slug);
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await visible('.admin-login');
  assert.equal((await (await context.request.get(`${origin}/api/session`)).json()).admin, false);
  await page.reload();
  await visible('.admin-login');
  await fillLogin();
  await ready();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await visible('.admin-login');
  assert.equal(external.size, 0, `External runtime requests: ${[...external].join(', ')}`);
  assert.deepEqual(errors, []);
  assert.ok(mutations.filter(item => !item.url.endsWith('/api/login')).every(item => typeof item.csrf === 'string' && item.csrf.length > 20));
  console.log('UI PASS: six local projects, filters/deep links/lightbox, invalid/valid/persistent login, duplicate creation prevention, cancel/dirty guards, upload validation, CSRF mutations, draft preservation, cover/publish/unpublish, mobile dismissal, session expiry/relogin, deletes, repeated logout/login, no remote requests or JS errors.');
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
