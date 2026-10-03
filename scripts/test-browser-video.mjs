import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

// Run against a fresh production frontend build: npm run build && node scripts/test-browser-video.mjs.
// Every login, upload and video below is synthetic and confined to this temporary localhost server.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'twoquarters-browser-video-'));
const port = Number(process.env.BROWSER_VIDEO_TEST_PORT || 3102);
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'test', DATA_DIR: directory, APP_ORIGIN: origin, PORT: String(port), HOST: '127.0.0.1' };
delete env.SITE_CONFIG_FILE;
const password = randomBytes(24).toString('hex');
execFileSync(process.execPath, ['scripts/database.mjs', 'init', '--maintenance'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
const project = {
  id: '5fe8f5b0-0d47-4163-a51e-77f72f3893a2', slug: 'browser-video-test', title: '浏览器视频测试', titleEn: 'Browser video test',
  category: 'video', year: '2026', discipline: 'Video', summary: '', credits: '', published: false, images: [], videos: [],
};
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import { hashPassword } from './server/auth.mjs';
  import { db } from './server/store.mjs';
  let input=''; for await (const chunk of process.stdin) input += chunk;
  const {password,project}=JSON.parse(input);
  db.prepare('INSERT INTO users VALUES(?,?)').run('browser-video-test',await hashPassword(password));
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(project.id,project.slug,JSON.stringify(project),0,0);
  db.close();
`], { cwd: root, env, input: JSON.stringify({ password, project }), stdio: ['pipe', 'pipe', 'pipe'] });

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
const ffmpegHelp = execFileSync('ffmpeg', ['-hide_banner', '-h', 'full'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const supportsDisplayRotation = ffmpegHelp.includes('-display_rotation');
const probeFile = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
const fixtures = [
  { name: 'landscape-audio', width: 320, height: 180, audio: true },
  { name: 'portrait-silent', width: 180, height: 320, audio: false },
  { name: 'rotated-audio', width: 180, height: 320, audio: true, rotation: true },
  { name: 'rotated-silent', width: 180, height: 320, audio: false, rotation: true },
  { name: 'delayed-audio', width: 320, height: 180, audio: true, audioDelay: 0.3 },
];
for (const fixture of fixtures) {
  fixture.file = path.join(directory, `${fixture.name}.mp4`);
  const codedWidth = fixture.rotation ? fixture.height : fixture.width;
  const codedHeight = fixture.rotation ? fixture.width : fixture.height;
  const target = fixture.rotation ? path.join(directory, 'rotation-source.mp4') : fixture.file;
  ffmpeg('-f', 'lavfi', '-i', `testsrc2=size=${codedWidth}x${codedHeight}:rate=24`,
    ...(fixture.audio ? [...(fixture.audioDelay ? ['-itsoffset', String(fixture.audioDelay)] : []), '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000'] : []),
    '-t', '1.2', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p',
    ...(fixture.audio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']), '-movflags', '+faststart', target);
  if (fixture.rotation) {
    if (supportsDisplayRotation) ffmpeg('-display_rotation', '90', '-i', target, '-c', 'copy', fixture.file);
    else ffmpeg('-i', target, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', fixture.file);
    const video = probeFile(fixture.file).streams.find(stream => stream.codec_type === 'video');
    const rotation = video.side_data_list?.find(data => data.side_data_type === 'Display Matrix')?.rotation ?? Number(video.tags?.rotate || 0);
    assert.equal(Math.abs(rotation) % 180, 90, 'rotation fixture must contain an actual display matrix');
  }
}
const originalBytes = await readFile(fixtures[0].file);
const mockOutput = 'fixture compressed output, never original';
const server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });
let browser;
const posts = [];
const errors = [];
const external = new Set();
const pendingRoutes = new Set();
let holdUpload = false;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server failed: ${serverOutput}`);
    try { if ((await fetch(`${origin}/api/session`)).ok) break; } catch { /* Startup is asynchronous. */ }
    if (attempt === 99) throw new Error(`Test server timed out: ${serverOutput}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const systemChromium = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
  const executablePath = await access(systemChromium).then(() => systemChromium).catch(() => undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  context.on('request', request => {
    if (!request.url().startsWith(origin)) external.add(request.url());
  });
  await page.addInitScript(({ mockOutput }) => {
    const NativeWorker = window.Worker;
    const nativeFetch = window.fetch.bind(window);
    const state = window.__videoTest = { mode: 'unsupported', workers: [], abortedFetches: 0 };
    window.fetch = (input, init) => {
      if (typeof input === 'string' && /\/videos$/.test(input) && init?.method === 'POST') {
        init.signal?.addEventListener('abort', () => { state.abortedFetches++; }, { once: true });
      }
      return nativeFetch(input, init);
    };
    window.Worker = class TestWorker extends EventTarget {
      constructor(url, options) {
        super();
        if (state.mode === 'unsupported') throw new DOMException('Fixture encoder unsupported', 'NotSupportedError');
        this.record = { mode: state.mode, started: false, terminated: false, cancelled: false, events: [] };
        state.workers.push(this.record);
        this.mode = state.mode;
        if (state.mode === 'native') {
          const worker = new NativeWorker(url, options);
          const record = this.record;
          worker.addEventListener('message', event => record.events.push(event.data.type));
          const terminate = worker.terminate.bind(worker);
          worker.terminate = () => { record.terminated = true; terminate(); };
          return worker;
        }
      }
      emit(data) {
        if (this.record.terminated) return;
        this.record.events.push(data.type);
        const event = new MessageEvent('message', { data });
        this.onmessage?.(event);
        this.dispatchEvent(event);
      }
      postMessage(data) {
        if (data.type === 'cancel') {
          this.record.cancelled = true;
          if (this.mode !== 'hold-ignore-cancel') queueMicrotask(() => this.emit({ type: 'error', name: 'AbortError', message: 'Fixture cancelled' }));
          return;
        }
        if (data.type !== 'start') throw new Error(`Unexpected worker request: ${data.type}`);
        this.record.started = true;
        this.record.inputName = data.file.name;
        this.record.inputBytes = data.file.size;
        void (async () => {
          // A partial OPFS file tests cleanup on failures as well as cancellation.
          const stream = await data.output.createWritable();
          await stream.write(mockOutput);
          await stream.close();
          if (this.record.terminated) return;
          this.emit({ type: 'progress', progress: 0.37 });
          if (this.mode === 'failure') this.emit({ type: 'error', name: 'EncodingError', message: 'Fixture mid-encode failure' });
          else if (this.mode === 'crash') {
            const event = new ErrorEvent('error', { message: 'Fixture worker crash' });
            this.onerror?.(event);
            this.dispatchEvent(event);
          } else if (this.mode === 'success') this.emit({ type: 'complete' });
        })().catch(error => this.emit({ type: 'error', name: error.name, message: error.message }));
      }
      terminate() { this.record.terminated = true; }
    };
  }, { mockOutput });
  await page.route('**/api/admin/projects/*/videos', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    posts.push({ headers: request.headers(), body: request.postDataBuffer() });
    if (holdUpload) {
      pendingRoutes.add(route);
      return;
    }
    await route.fulfill({ status: 202, json: project });
  });
  const ready = (timeout = 15000) => page.waitForFunction(() => {
    const input = document.querySelector('.video-manager input[type=file]');
    return input && !input.disabled && !document.querySelector('.video-local-progress');
  }, undefined, { timeout });
  const setMode = mode => page.evaluate(value => { window.__videoTest.mode = value; }, mode);
  const input = () => page.locator('.video-manager input[type=file]');
  const browserMode = () => page.locator('.video-compression-options input[value=browser]');
  const serverMode = () => page.locator('.video-compression-options input[value=server]');
  const noLocalFiles = () => page.waitForFunction(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      const directory = await root.getDirectoryHandle('twoquarters-video-compression');
      for await (const entry of directory.values()) if (entry.kind === 'file') return false;
      return true;
    } catch (error) { if (error.name === 'NotFoundError') return true; throw error; }
  });
  const noLiveWorkers = () => page.waitForFunction(() => window.__videoTest.workers.every(worker => worker.terminated));
  const checkedBrowser = async () => assert.equal(await browserMode().isChecked(), true, 'failure must never silently switch mode');
  const resetInput = async () => assert.equal(await input().inputValue(), '', 'same-file retry must be possible');
  const notice = () => page.locator('.admin-notice');
  const pass = name => console.log(`BROWSER VIDEO PASS: ${name}`);

  await page.goto(`${origin}/admin`);
  await page.getByLabel('用户名', { exact: true }).fill('browser-video-test');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await ready();
  assert.equal(await serverMode().isChecked(), true, 'server upload must remain the default');
  await browserMode().check();
  for (const mode of ['unsupported', 'failure', 'failure', 'crash']) {
    await setMode(mode);
    const before = posts.length;
    await input().setInputFiles(fixtures[0].file);
    await notice().filter({ hasText: '没有上传视频' }).waitFor();
    await ready();
    assert.equal(posts.length, before, `${mode}: no automatic original upload`);
    await checkedBrowser();
    await resetInput();
    await noLiveWorkers();
    await noLocalFiles();
    pass(`${mode}: zero POSTs, mode retained, resources cleaned, same-file retry enabled`);
  }

  for (const mode of ['hold', 'hold-ignore-cancel']) {
    await setMode(mode);
    const before = posts.length;
    await input().setInputFiles(fixtures[0].file);
    await page.waitForFunction(() => document.querySelector('progress')?.value === 0.37);
    assert.equal(await input().isDisabled(), true);
    assert.equal(await serverMode().isDisabled(), true);
    await page.getByRole('button', { name: '取消压缩', exact: true }).click();
    await notice().filter({ hasText: '已取消本地处理，没有上传视频' }).waitFor();
    await ready();
    assert.equal(posts.length, before, 'cancellation must never upload the original');
    await checkedBrowser();
    await resetInput();
    await noLiveWorkers();
    await noLocalFiles();
    pass(`${mode}: cancel sends zero POSTs and cleans the partial OPFS output`);
  }

  // Repeated success proves only the returned compressed File is submitted, never the source bytes.
  await setMode('success');
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = posts.length;
    await input().setInputFiles(fixtures[0].file);
    await notice().filter({ hasText: '视频已上传' }).waitFor();
    await ready();
    assert.equal(posts.length, before + 1);
    assert.equal(posts.at(-1).headers['x-video-compression'], 'browser');
    assert.equal(posts.at(-1).headers['content-type'], 'video/mp4');
    assert.ok(posts.at(-1).headers['x-csrf-token']);
    assert.deepEqual(posts.at(-1).body, Buffer.from(mockOutput));
    assert.notDeepEqual(posts.at(-1).body, originalBytes);
    await noLocalFiles();
    await noLiveWorkers();
    await resetInput();
  }
  pass('repeat successful uploads send only compressed bytes and dispose OPFS files');

  // A local failure only becomes a server upload after BOTH explicit reselect and file selection.
  await setMode('failure');
  await input().setInputFiles(fixtures[0].file);
  await notice().filter({ hasText: '没有上传视频' }).waitFor();
  await ready();
  const beforeServer = posts.length;
  await serverMode().check();
  assert.equal(posts.length, beforeServer, 'selecting server mode alone must not upload');
  await input().setInputFiles(fixtures[0].file);
  await notice().filter({ hasText: '视频已上传' }).waitFor();
  await ready();
  assert.equal(posts.length, beforeServer + 1);
  assert.equal(posts.at(-1).headers['x-video-compression'], 'server');
  assert.deepEqual(posts.at(-1).body, originalBytes);
  pass('manual server reselect plus a fresh file choice explicitly uploads the original');

  // Once a POST begins, cancellation is honestly presented as stopping the request, not undoing it.
  await browserMode().check();
  await setMode('success');
  holdUpload = true;
  const beforeAbort = posts.length;
  const uploadRequest = page.waitForRequest(request => /\/videos$/.test(request.url()) && request.method() === 'POST');
  await input().setInputFiles(fixtures[0].file);
  await uploadRequest;
  await page.getByRole('button', { name: '取消上传', exact: true }).waitFor();
  await page.getByRole('button', { name: '取消上传', exact: true }).click();
  await notice().filter({ hasText: '已停止上传请求' }).waitFor();
  await ready();
  assert.equal(posts.length, beforeAbort + 1, 'upload abort must not retry or fall back');
  assert.equal(await page.evaluate(() => window.__videoTest.abortedFetches), 1);
  await noLocalFiles();
  await noLiveWorkers();
  for (const route of pendingRoutes) await route.abort('aborted').catch(() => {});
  pendingRoutes.clear();
  holdUpload = false;
  pass('upload abort propagates AbortSignal, does not retry, and removes local output');

  // Simulate same-tab client navigation, which must invoke React unmount cleanup.
  await setMode('hold');
  const beforeNavigation = posts.length;
  await input().setInputFiles(fixtures[0].file);
  await page.waitForFunction(() => document.querySelector('progress')?.value === 0.37);
  await page.evaluate(() => { history.pushState({}, '', '/works'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.locator('.admin-shell').waitFor({ state: 'detached' });
  await noLiveWorkers();
  await noLocalFiles();
  assert.equal(posts.length, beforeNavigation, 'navigation must cancel without uploading');
  await page.goBack();
  await ready();
  assert.equal(await serverMode().isChecked(), true);
  pass('client navigation aborts active compression; back navigation returns an unlocked editor');
  if (process.env.BROWSER_VIDEO_TEST_ARTIFACTS) {
    await mkdir(process.env.BROWSER_VIDEO_TEST_ARTIFACTS, { recursive: true });
    await page.locator('.video-manager').screenshot({ path: path.join(process.env.BROWSER_VIDEO_TEST_ARTIFACTS, 'browser-video-mode-options.png') });
  }

  // Real Linux Chromium codec smoke tests are reported distinctly from mocked UI contracts.
  const nativeResults = [];
  await browserMode().check();
  await setMode('native');
  for (const fixture of fixtures) {
    const before = posts.length;
    await input().setInputFiles(fixture.file);
    await ready(120000);
    const message = await notice().textContent();
    if (posts.length === before) {
      assert.match(message, /浏览器压缩失败，没有上传视频/);
      assert.match(message, /不能编码|无法解码此视频|不支持工作线程中的 WebCodecs|本地临时存储不可用|不支持流式本地临时文件/, 'native fixture failures must be verified capability failures, not hidden implementation bugs');
      nativeResults.push({ fixture: fixture.name, status: 'unsupported', reason: message });
    } else {
      assert.equal(posts.length, before + 1);
      assert.equal(posts.at(-1).headers['x-video-compression'], 'browser');
      const output = path.join(directory, `${fixture.name}-compressed.mp4`);
      await writeFile(output, posts.at(-1).body);
      const probe = probeFile(output);
      const video = probe.streams.find(stream => stream.codec_type === 'video');
      const audio = probe.streams.find(stream => stream.codec_type === 'audio');
      assert.equal(video.codec_name, 'h264');
      assert.equal(video.width, fixture.width);
      assert.equal(video.height, fixture.height);
      assert.equal(Boolean(audio), fixture.audio);
      if (audio) {
        assert.equal(audio.codec_name, 'aac');
        const inputProbe = probeFile(fixture.file);
        const inputVideo = inputProbe.streams.find(stream => stream.codec_type === 'video');
        const inputAudio = inputProbe.streams.find(stream => stream.codec_type === 'audio');
        const inputOffset = Number(inputAudio.start_time || 0) - Number(inputVideo.start_time || 0);
        const outputOffset = Number(audio.start_time || 0) - Number(video.start_time || 0);
        assert.ok(Math.abs(outputOffset - inputOffset) <= 0.06, `audio/video sync offset changed: input ${inputOffset}, output ${outputOffset}`);
      }
      const [numerator, denominator] = video.avg_frame_rate.split('/').map(Number);
      assert.ok(numerator / denominator <= 30.01);
      assert.ok(Number(probe.format.duration) >= 1 && Number(probe.format.duration) <= 1.5);
      nativeResults.push({ fixture: fixture.name, status: 'compressed-and-probed', video: video.codec_name, audio: audio?.codec_name || null, width: video.width, height: video.height, bytes: posts.at(-1).body.length });
    }
    await checkedBrowser();
    await noLocalFiles();
    await noLiveWorkers();
    await resetInput();
  }
  console.log(`BROWSER VIDEO NATIVE RESULTS (${await browser.version()}, ${process.platform}): ${JSON.stringify(nativeResults)}`);
  assert.deepEqual(errors, [], `Uncaught browser errors: ${errors.join('; ')}`);
  assert.equal(external.size, 0, `Unexpected nonlocal runtime requests: ${[...external].join(', ')}`);
  console.log('BROWSER VIDEO UI PASS: failure, unsupported, repeat, cancellation, upload abort, manual fallback, navigation cleanup, no external requests or uncaught errors. Native codec results above are Linux-only; Windows/macOS are not verified.');
} finally {
  for (const route of pendingRoutes) await route.abort('aborted').catch(() => {});
  if (browser) await browser.close();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
