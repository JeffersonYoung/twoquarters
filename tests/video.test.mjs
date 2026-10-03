import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';

// No shared database, fixed passwords, checked-in media, or network services.
const cwd = process.cwd(), origin = 'http://127.0.0.1:3199';
const details = { title: 'Video integration fixture', titleEn: 'Video test', category: 'bts', year: '2026', published: false };
let child, directory, dataDir, cookie, csrf, toolDir, ffmpegLog, serverLog = '';

async function command(binary, args, options = {}) {
  const p = spawn(binary, args, { cwd, ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '';
  p.stdout.on('data', b => output += b);
  p.stderr.on('data', b => error += b);
  if (options.input) p.stdin.end(options.input); else p.stdin.end();
  const code = await new Promise((resolve, reject) => { p.once('error', reject); p.once('exit', resolve); });
  assert.equal(code, 0, `${binary} failed: ${error}`);
  return output;
}
async function request(route, { method = 'GET', body, auth = true, token = true, from = origin, headers = {} } = {}) {
  const h = { ...headers };
  if (auth) { h.Cookie = cookie; if (token) h['X-CSRF-Token'] = csrf; }
  if (!['GET', 'HEAD'].includes(method)) h.Origin = from;
  if (body && !(body instanceof FormData) && !Buffer.isBuffer(body)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  return fetch(origin + route, { method, headers: h, body });
}
async function project(id) {
  const response = await request('/api/admin/projects');
  assert.equal(response.status, 200);
  return (await response.json()).find(p => p.id === id);
}
async function createProject() {
  const response = await request('/api/admin/projects', { method: 'POST', body: details });
  assert.equal(response.status, 201);
  return response.json();
}
async function upload(id, bytes, type = 'video/mp4', name = 'fixture.mp4', options = {}) {
  return request(`/api/admin/projects/${id}/videos`, { method: 'POST', body: bytes, ...options, headers: { 'Content-Type': type, 'X-Upload-Name': encodeURIComponent(name), ...options.headers } });
}
async function accepted(id, bytes, type, name, options) {
  const before = new Set((await project(id)).videos.map(v => v.id));
  const response = await upload(id, bytes, type, name, options);
  assert.equal(response.status, 202, await response.clone().text());
  const p = await response.json(), video = p.videos.find(v => !before.has(v.id));
  assert.ok(video, 'upload response contains the new video');
  assert.ok(['queued', 'processing', 'ready', 'failed'].includes(video.status));
  assert.equal(video.sourceBytes, bytes.length);
  return video;
}
async function terminal(projectId, videoId) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const v = (await project(projectId))?.videos.find(v => v.id === videoId);
    assert.ok(v, 'video remains available to admin while processing');
    if (['ready', 'failed'].includes(v.status)) return v;
    assert.ok(['queued', 'processing'].includes(v.status));
    await delay(30);
  }
  assert.fail(`Video never reached terminal status. ${serverLog}`);
}
async function videoFiles(id) { return (await readdir(path.join(dataDir, 'uploads'))).filter(name => name.startsWith(`video-${id}.`)).sort(); }
async function assertFiles(id, expected) {
  // Worker cleanup can finish immediately after the terminal status is visible.
  for (let i = 0; i < 40; i++) { if (JSON.stringify(await videoFiles(id)) === JSON.stringify(expected)) return; await delay(25); }
  assert.deepEqual(await videoFiles(id), expected, 'original and intermediate files must be deleted');
}
async function start() {
    child = spawn(process.execPath, ['server/index.mjs'], { cwd, env: { ...process.env, PATH: toolDir + path.delimiter + process.env.PATH, DATA_DIR: dataDir, PORT: '3199', HOST: '127.0.0.1', APP_ORIGIN: origin, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', b => serverLog += b); child.stdout.on('data', b => serverLog += b);
    let started = false;
    for (let i = 0; i < 100; i++) {
      assert.equal(child.exitCode, null, serverLog);
      try { if ((await fetch(origin + '/api/session')).ok) { started = true; break; } } catch {}
      await delay(50);
    }
    assert.ok(started, `Server startup failed: ${serverLog}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const p = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  await p; clearTimeout(timeout); child = undefined;
}

// The test intentionally fails when FFmpeg is missing: production video support
// requires both tools, and silently skipping would hide a broken deployment.
test('video upload, transcode, privacy, byte ranges, and destructive cleanup', { timeout: 180_000 }, async t => {
  directory = await mkdtemp(path.join(tmpdir(), 'tq-video-'));
  dataDir = path.join(directory, 'data');
  const fixtureDir = path.join(directory, 'fixtures'); await mkdir(fixtureDir);
  toolDir = path.join(directory,'bin'); await mkdir(toolDir);
  ffmpegLog = path.join(directory,'ffmpeg.log'); await writeFile(ffmpegLog,'');
  const realFfmpeg = (await command('which',['ffmpeg'])).trim();
  await writeFile(path.join(toolDir,'ffmpeg'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${ffmpegLog}'\nexec '${realFfmpeg}' "$@"\n`);
  await chmod(path.join(toolDir,'ffmpeg'),0o700);
  const mp4Path = path.join(fixtureDir, 'landscape.mp4'), webmPath = path.join(fixtureDir, 'portrait.webm');
  try {
    await command('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=2560x1440:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','0.5','-c:v','mpeg4','-q:v','2','-threads','2','-c:a','aac',mp4Path]);
    await command('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=120x200:rate=12','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','0.5','-c:v','libvpx-vp9','-threads','2','-deadline','realtime','-c:a','libopus',webmPath]);
    const mp4 = await readFile(mp4Path), webm = await readFile(webmPath);
    const username = `video-${randomUUID()}`, password = randomUUID() + randomUUID();
    await command(process.execPath, ['scripts/database.mjs','init','--maintenance'], { env: { ...process.env, DATA_DIR: dataDir } });
    await command(process.execPath, ['scripts/admin.mjs', username, '--stdin'], { env: { ...process.env, DATA_DIR: dataDir }, input: password + '\n' });
    await start();
    const login = await request('/api/login', { method: 'POST', auth: false, body: { username, password } });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0]; csrf = (await login.json()).csrfToken;
    const p = await createProject(), endpoint = `/api/admin/projects/${p.id}`;
    let landscape, portrait;

    await t.test('rejects unauthenticated, missing CSRF, and cross-origin uploads', async () => {
      assert.equal((await upload(p.id, mp4, 'video/mp4', 'x.mp4', { auth: false })).status, 401);
      assert.equal((await upload(p.id, mp4, 'video/mp4', 'x.mp4', { token: false })).status, 403);
      assert.equal((await upload(p.id, mp4, 'video/mp4', 'x.mp4', { from: 'https://untrusted.example' })).status, 403);
      assert.equal((await project(p.id)).videos.length, 0);
    });
    await t.test('rejects unsupported type, empty body, malformed filename, and oversized declared body', async () => {
      assert.equal((await upload(p.id, mp4, 'application/octet-stream')).status, 415);
      for (const mode of ['true','none','Browser','browser, server']) {
        assert.equal((await upload(p.id, mp4, 'video/mp4', 'x.mp4', { headers: { 'X-Video-Compression': mode } })).status, 400);
      }
      assert.equal((await upload(p.id, Buffer.alloc(0))).status, 400);
      assert.equal((await upload(p.id, mp4, 'video/mp4', 'x', { headers: { 'Content-Type': 'video/mp4', 'X-Upload-Name': '%ZZ' } })).status, 400);
      const status = await new Promise((resolve, reject) => {
        const req = http.request(origin + endpoint + '/videos', { method: 'POST', agent: false, headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'video/mp4', 'Content-Length': 250 * 1024 * 1024 + 1 } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Oversize rejection timed out'))); req.end();
      });
      assert.equal(status, 413);
      assert.equal((await project(p.id)).videos.length, 0);
      assert.equal((await readdir(path.join(dataDir, 'uploads'))).filter(n => n.startsWith('video-')).length, 0);
    });
    await t.test('malformed data becomes failed, deletes original, and cannot retry without a fresh file', async () => {
      const v = await accepted(p.id, Buffer.from('not a video'), 'video/mp4');
      const failed = await terminal(p.id, v.id);
      assert.equal(failed.status, 'failed'); assert.ok(failed.error); assert.equal(failed.outputBytes, null);
      assert.equal((await request(v.src)).status, 404);
      const retry = await request(`${endpoint}/videos/${v.id}/retry`, { method: 'POST' });
      assert.ok([404, 405, 409, 410].includes(retry.status), `fresh upload required, got ${retry.status}`);
      await assertFiles(v.id, []);
    });
    await t.test('MP4 becomes a smaller H.264/AAC 1080p file and discards source', async () => {
      const v = await accepted(p.id, mp4, 'video/mp4', '../电影 🎬.mp4');
      landscape = await terminal(p.id, v.id);
      assert.equal(landscape.status, 'ready', landscape.error);
      assert.equal(landscape.name, '电影 🎬.mp4');
      assert.equal(landscape.width, 1920); assert.equal(landscape.height, 1080);
      assert.ok(landscape.duration > 0 && landscape.duration < 2);
      assert.ok(landscape.outputBytes > 0 && landscape.outputBytes < mp4.length);
      const output = path.join(dataDir, 'uploads', `video-${v.id}.mp4`);
      const info = JSON.parse(await command('ffprobe', ['-v','error','-show_streams','-show_format','-of','json', output]));
      assert.equal(info.streams.find(s => s.codec_type === 'video').codec_name, 'h264');
      assert.equal(info.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
      const bytes = await readFile(output);
      assert.ok(bytes.indexOf(Buffer.from('moov')) < bytes.indexOf(Buffer.from('mdat')), 'faststart metadata precedes media');
      assert.equal((await stat(output)).mode & 0o077, 0, 'transcoded file is private on disk');
      await assertFiles(v.id, [`video-${v.id}.mp4`]);
    });
    await t.test('compliant WebM preserves codecs and packets without encoding', async () => {
      const logBefore = (await readFile(ffmpegLog,'utf8')).length;
      const v = await accepted(p.id, webm, 'video/webm', 'portrait.webm');
      portrait = await terminal(p.id, v.id);
      assert.equal(portrait.status, 'ready', portrait.error + serverLog);
      assert.equal(portrait.contentType, 'video/webm');
      assert.equal(portrait.width, 120); assert.equal(portrait.height, 200);
      const output = path.join(dataDir,'uploads',`video-${v.id}.webm`);
      const hashes = async filename => JSON.parse(await command('ffprobe', ['-v','error','-fflags','+noparse',
        '-show_packets','-show_data_hash','sha256','-show_entries','packet=stream_index,data_hash','-of','json',filename])).packets.map(p => [p.stream_index,p.data_hash]);
      assert.deepEqual(await hashes(output), await hashes(webmPath));
      const commands = (await readFile(ffmpegLog,'utf8')).slice(logBefore);
      assert.match(commands, /-c copy/); assert.doesNotMatch(commands, /libx264/);
      for (const method of ['GET','HEAD']) assert.equal((await request(portrait.src,{method,auth:false})).status,404);
      const response = await request(portrait.src);
      assert.equal(response.headers.get('content-type'),'video/webm');
      await assertFiles(v.id, [`video-${v.id}.webm`]);
      await stop(); await start();
      assert.equal((await request(portrait.src)).status,200,'ready WebM survives restart');
    });
    await t.test('oversized WebM is normalized to MP4 while truncated WebM is rejected', async () => {
      const separate = await createProject();
      try {
        const input = path.join(fixtureDir,'large.webm');
        await command('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=2000x1200:rate=12',
          '-f','lavfi','-i','sine=sample_rate=48000','-t','0.5','-c:v','libvpx-vp9','-threads','2','-deadline','realtime','-c:a','libopus',input]);
        const v = await accepted(separate.id,await readFile(input),'video/webm','large.webm');
        const ready = await terminal(separate.id,v.id);
        assert.equal(ready.status,'ready',ready.error + serverLog); assert.equal(ready.contentType,'video/mp4');
        assert.ok(ready.width <= 1920 && ready.height <= 1080);
        const packetInfo = JSON.parse(await command('ffprobe',['-v','error','-fflags','+noparse','-select_streams','v','-show_packets','-show_entries','packet=pos,size','-of','json',webmPath]));
        const packet = packetInfo.packets[0], corrupt = Buffer.from(webm);
        corrupt.fill(0xff,Number(packet.pos)+32,Number(packet.pos)+Math.min(Number(packet.size),300));
        const damaged = await accepted(separate.id,corrupt,'video/webm','damaged.webm');
        assert.equal((await terminal(separate.id,damaged.id)).status,'failed','corrupt codec payload is rejected'); await assertFiles(damaged.id,[]);
        const broken = await accepted(separate.id,webm.subarray(0,Math.floor(webm.length*0.65)),'video/webm','broken.webm');
        assert.equal((await terminal(separate.id,broken.id)).status,'failed'); await assertFiles(broken.id,[]);
      } finally { await request(`/api/admin/projects/${separate.id}`,{method:'DELETE'}); }
    });
    await t.test('compliant originals and browser output preserve video/audio packets without invoking an encoder', async () => {
      const separate = await createProject(), input = path.join(fixtureDir,'compliant.mp4');
      await command('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25',
        '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-threads','2','-crf','26',
        '-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-metadata','comment=private upload metadata',input]);
      const original = await readFile(input);
      const hashes = async filename => {
        const info = JSON.parse(await command('ffprobe',['-v','error','-show_packets','-show_data_hash','sha256',
          '-show_entries','packet=codec_type,stream_index,data_hash','-of','json',filename]));
        return info.packets.map(packet => [packet.codec_type,packet.stream_index,packet.data_hash]);
      };
      const expected = await hashes(input);
      for (const mode of [undefined,'server','browser']) {
        const beforeLog = (await readFile(ffmpegLog,'utf8')).length;
        const v = await accepted(separate.id,original,'video/mp4','original.mp4',mode ? { headers: { 'X-Video-Compression': mode } } : undefined);
        const ready = await terminal(separate.id,v.id);
        assert.equal(ready.status,'ready',`${mode}: ${ready.error}`);
        const output = path.join(dataDir,'uploads',`video-${v.id}.mp4`);
        assert.deepEqual(await hashes(output),expected,`${mode || 'legacy'} must preserve all encoded packets`);
        const commands = (await readFile(ffmpegLog,'utf8')).slice(beforeLog);
        assert.match(commands,/-c copy/, 'compliant input uses lossless stream copy');
        assert.doesNotMatch(commands,/libx264| -c:a aac/, 'no media encoder is invoked for compliant input');
        assert.match(commands,/-f null/, 'copy path fully decodes media for validation');
        const bytes = await readFile(output);
        assert.ok(bytes.indexOf(Buffer.from('moov')) < bytes.indexOf(Buffer.from('mdat')), 'copy path adds faststart');
        assert.equal((await stat(output)).mode & 0o077,0);
        const info = JSON.parse(await command('ffprobe',['-v','error','-show_format','-of','json',output]));
        assert.equal(info.format.tags?.comment,undefined,'private metadata removed during remux');
        const db = new DatabaseSync(path.join(dataDir,'portfolio.sqlite'));
        try { assert.equal(db.prepare('SELECT compression_mode FROM videos WHERE id=?').get(v.id).compression_mode,mode || 'server'); }
        finally { db.close(); }
        await assertFiles(v.id,[`video-${v.id}.mp4`]);
      }
      const silent = path.join(fixtureDir,'silent-portrait.mp4');
      await command('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=120x200:rate=30',
        '-t','0.5','-c:v','libx264','-threads','2','-pix_fmt','yuv420p',silent]);
      const v = await accepted(separate.id,await readFile(silent),'video/mp4','silent.mp4',{ headers: { 'X-Video-Compression': 'browser' } });
      const ready = await terminal(separate.id,v.id); assert.equal(ready.status,'ready',ready.error);
      assert.deepEqual(await hashes(path.join(dataDir,'uploads',`video-${v.id}.mp4`)),await hashes(silent));
      assert.equal(ready.width,120); assert.equal(ready.height,200);
      await request(`/api/admin/projects/${separate.id}`,{ method:'DELETE' });
    });
    await t.test('browser mode cannot bypass actual container, codec, dimensions, rate, bitrate, aspect, or corruption validation', async () => {
      const separate = await createProject();
      const options = { headers: { 'X-Video-Compression':'browser' } };
      const reject = async (bytes,name,type='video/mp4') => {
        const beforeLog = (await readFile(ffmpegLog,'utf8')).length;
        const v = await accepted(separate.id,bytes,type,name,options);
        const failed = await terminal(separate.id,v.id);
        assert.equal(failed.status,'failed',name); assert.match(failed.error,/服务器压缩/);
        assert.equal((await request(v.src)).status,404); await assertFiles(v.id,[]);
        assert.doesNotMatch((await readFile(ffmpegLog,'utf8')).slice(beforeLog),/libx264/,'browser mode never silently falls back to encoding');
      };
      await reject(mp4,'uncompressed.mp4');
      await reject(webm,'not-mp4.webm','video/webm');
      await reject(webm,'spoofed.mp4');
      for (const [name,source,extra] of [
        ['dimensions','color=size=1922x1080:rate=25',[]],
        ['frame-rate','color=size=64x64:rate=31',[]],
        ['aspect','color=size=64x64:rate=25',['-vf','setsar=2']],
        ['bitrate','testsrc2=size=1280x720:rate=30',['-qp','0']],
        ['pixel-format','color=size=64x64:rate=25',['-pix_fmt','yuv444p']],
      ]) {
        const sourcePath = path.join(fixtureDir,`browser-${name}.mp4`);
        await command('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',source,'-t','1',
          '-c:v','libx264','-threads','2',...extra,sourcePath]);
        await reject(await readFile(sourcePath),name+'.mp4');
      }
      const audioPath = path.join(fixtureDir,'browser-audio-bitrate.mp4');
      await command('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=size=64x64:rate=25',
        '-f','lavfi','-i','anoisesrc=sample_rate=48000','-t','1','-c:v','libx264','-threads','2',
        '-c:a','aac','-b:a','256k','-ac','2',audioPath]);
      await reject(await readFile(audioPath),'audio-bitrate.mp4');
      const quicktimePath = path.join(fixtureDir,'browser-quicktime.mov');
      await command('ffmpeg',['-hide_banner','-loglevel','error','-i',path.join(fixtureDir,'compliant.mp4'),'-c','copy',quicktimePath]);
      await reject(await readFile(quicktimePath),'quicktime.mov','video/quicktime');
      const extraPath = path.join(fixtureDir,'browser-extra-track.mp4');
      await command('ffmpeg',['-hide_banner','-loglevel','error','-i',path.join(fixtureDir,'compliant.mp4'),'-map','0:v','-map','0:v','-c','copy',extraPath]);
      await reject(await readFile(extraPath),'extra-track.mp4');
      const valid = await readFile(path.join(fixtureDir,'compliant.mp4'));
      const rotated = Buffer.from(valid), track = rotated.indexOf(Buffer.from('tkhd'));
      [0,-65536,0,65536,0,0,0,0,1073741824].forEach((value,i) => rotated.writeInt32BE(value,track+44+i*4));
      await reject(rotated,'rotation.mp4');
      const corrupt = Buffer.from(valid), media = corrupt.indexOf(Buffer.from('mdat'));
      assert.ok(media > 0); corrupt.fill(0,media+4,Math.min(media+1500,corrupt.length));
      await reject(corrupt,'corrupt.mp4');
      await reject(valid.subarray(0,valid.length-32),'truncated.mp4');
      await request(`/api/admin/projects/${separate.id}`,{ method:'DELETE' });
    });
    await t.test('server mode normalizes noncompliant H.264 instead of trusting codec alone', async () => {
      const separate = await createProject();
      for (const name of ['bitrate','frame-rate','aspect','audio-bitrate']) {
        const input = await readFile(path.join(fixtureDir,`browser-${name}.mp4`));
        const beforeLog = (await readFile(ffmpegLog,'utf8')).length;
        const v = await accepted(separate.id,input,'video/mp4',name+'.mp4',{ headers:{ 'X-Video-Compression':'server' } });
        const ready = await terminal(separate.id,v.id); assert.equal(ready.status,'ready',`${name}: ${ready.error}`);
        assert.match((await readFile(ffmpegLog,'utf8')).slice(beforeLog),/libx264/);
        const info = JSON.parse(await command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path.join(dataDir,'uploads',`video-${v.id}.mp4`)]));
        const video = info.streams.find(stream => stream.codec_type === 'video');
        const [n,d] = video.avg_frame_rate.split('/').map(Number);
        assert.ok(n/d <= 30); assert.equal(video.sample_aspect_ratio,'1:1');
        assert.equal(video.codec_name,'h264');
        assert.ok(info.streams.filter(stream => stream.codec_type === 'audio').every(stream => stream.codec_name === 'aac' && stream.channels <= 2));
        await assertFiles(v.id,[`video-${v.id}.mp4`]);
      }
      await request(`/api/admin/projects/${separate.id}`,{ method:'DELETE' });
    });
    await t.test('server CRF normalization accepts short noisy clips above copy-eligibility bitrate caps', async () => {
      const separate = await createProject();
      for (const duration of ['0.2','0.5']) {
        const input = path.join(fixtureDir,`short-noise-${duration}.mp4`);
        await command('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',
          'color=size=1920x1080:rate=30,noise=alls=100:allf=t+u:all_seed=1234',
          '-t',duration,'-c:v','libx264','-threads','2','-preset','ultrafast','-crf','10',input]);
        const v = await accepted(separate.id,await readFile(input),'video/mp4',`noise-${duration}.mp4`,
          { headers:{ 'X-Video-Compression':'server' } });
        const ready = await terminal(separate.id,v.id);
        assert.equal(ready.status,'ready',`${duration}s short noisy original must remain supported: ${ready.error}`);
        const output = path.join(dataDir,'uploads',`video-${v.id}.mp4`);
        const info = JSON.parse(await command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]));
        const video = info.streams.find(stream => stream.codec_type === 'video');
        assert.ok(Number(video.bit_rate) > 4500000,'fixture exercises a legitimate CRF bitrate above skip threshold');
        assert.equal(video.codec_name,'h264'); assert.equal(video.pix_fmt,'yuv420p');
        assert.equal(video.width,1920); assert.equal(video.height,1080);
        assert.ok(Number(info.format.duration) >= Number(duration)-0.025);
        await assertFiles(v.id,[`video-${v.id}.mp4`]);
        // The same high-bitrate output is not eligible to masquerade as an
        // already-compressed browser upload, even though it plays correctly.
        const strict = await accepted(separate.id,await readFile(output),'video/mp4','claimed-browser.mp4',
          { headers:{ 'X-Video-Compression':'browser' } });
        assert.equal((await terminal(separate.id,strict.id)).status,'failed');
        await assertFiles(strict.id,[]);
      }
      await request(`/api/admin/projects/${separate.id}`,{ method:'DELETE' });
    });
    await t.test('deleting a processing browser upload cannot retain or publish its source', async () => {
      const separate = await createProject();
      const v = await accepted(separate.id,await readFile(path.join(fixtureDir,'compliant.mp4')),'video/mp4','cancel.mp4',
        { headers:{ 'X-Video-Compression':'browser' } });
      let current;
      for (let i=0;i<100;i++) {
        current = (await project(separate.id)).videos.find(video => video.id === v.id);
        if (current.status === 'processing') break;
        assert.notEqual(current.status,'ready'); assert.notEqual(current.status,'failed'); await delay(5);
      }
      assert.equal(current.status,'processing');
      assert.equal((await request(`/api/admin/projects/${separate.id}/videos/${v.id}`,{ method:'DELETE' })).status,200);
      await assertFiles(v.id,[]); await delay(100); await assertFiles(v.id,[]);
      assert.equal((await request(v.src)).status,404);
      await request(`/api/admin/projects/${separate.id}`,{ method:'DELETE' });
    });
    await t.test('MOV rotation metadata becomes correctly oriented pixels with metadata stripped', async () => {
      const rotatedPath = path.join(fixtureDir, 'rotated.mov');
      await command('ffmpeg', ['-hide_banner','-loglevel','error','-i',mp4Path,'-c','copy',rotatedPath]);
      // Write the standard MOV track matrix directly so the fixture works on
      // FFmpeg 5 as well as newer versions with different rotation CLI flags.
      const rotated = await readFile(rotatedPath), track = rotated.indexOf(Buffer.from('tkhd'));
      assert.ok(track > 0); assert.equal(rotated[track + 4], 0, 'version-zero track header');
      [0,-65536,0,65536,0,0,0,0,1073741824].forEach((value, i) => rotated.writeInt32BE(value, track + 44 + i * 4));
      await writeFile(rotatedPath, rotated);
      const sourceInfo = JSON.parse(await command('ffprobe', ['-v','error','-show_streams','-of','json',rotatedPath]));
      assert.equal(sourceInfo.streams.find(s => s.codec_type === 'video').side_data_list.find(s => s.rotation !== undefined).rotation, 90);
      const separate = await createProject();
      const v = await accepted(separate.id, await readFile(rotatedPath), 'video/quicktime', 'phone.mov');
      const ready = await terminal(separate.id, v.id);
      assert.equal(ready.status, 'ready', ready.error);
      assert.equal(ready.width, 1080); assert.equal(ready.height, 1920);
      const info = JSON.parse(await command('ffprobe', ['-v','error','-show_streams','-of','json',path.join(dataDir,'uploads',`video-${v.id}.mp4`)]));
      const stream = info.streams.find(s => s.codec_type === 'video');
      assert.ok(!stream.tags?.rotate);
      assert.ok(!stream.side_data_list?.some(item => item.rotation));
      await assertFiles(v.id, [`video-${v.id}.mp4`]);
      assert.equal((await request(`/api/admin/projects/${separate.id}`, { method: 'DELETE' })).status, 200);
      await assertFiles(v.id, []);
    });
    await t.test('rejects oversized dimensions, duration, frame rate, and truncated containers without retaining originals', async () => {
      const separate = await createProject();
      for (const [name, source, duration] of [
        ['dimensions', 'color=size=4100x4:rate=1', '1'],
        ['duration', 'color=size=16x16:rate=1', '601'],
        ['frame-rate', 'color=size=16x16:rate=121', '0.1'],
      ]) {
        const input = path.join(fixtureDir, name + '.mp4');
        await command('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i',source,'-t',duration,'-c:v','libx264','-threads','2','-preset','ultrafast',input]);
        const v = await accepted(separate.id, await readFile(input), 'video/mp4', name + '.mp4');
        assert.equal((await terminal(separate.id, v.id)).status, 'failed', name);
        await assertFiles(v.id, []);
        assert.equal((await request(v.src)).status, 404);
      }
      const truncated = await accepted(separate.id, mp4.subarray(0, 32), 'video/mp4', 'truncated.mp4');
      assert.equal((await terminal(separate.id, truncated.id)).status, 'failed');
      await assertFiles(truncated.id, []);
      assert.equal((await request(`/api/admin/projects/${separate.id}`, { method: 'DELETE' })).status, 200);
    });
    await t.test('drafts are private; published files support GET, HEAD, and byte ranges', async () => {
      assert.ok(landscape?.id);
      for (const method of ['GET', 'HEAD']) assert.equal((await request(landscape.src, { method, auth: false })).status, 404);
      const admin = await request(landscape.src); assert.equal(admin.status, 200);
      const expected = Buffer.from(await admin.arrayBuffer());
      const form = new FormData();
      form.append('images', new Blob([await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer()], { type: 'image/png' }), 'cover.png');
      assert.equal((await request(endpoint + '/images', { method: 'POST', body: form })).status, 200);
      assert.equal((await request(endpoint, { method: 'PATCH', body: { ...details, published: true } })).status, 200);
      const publicProject = (await (await request('/api/projects', { auth: false })).json()).find(item => item.id === p.id);
      assert.equal(publicProject.videos.length, 2);
      const webmRange = await request(portrait.src,{auth:false,headers:{Range:'bytes=0-15'}});
      assert.equal(webmRange.status,206); assert.equal(webmRange.headers.get('content-type'),'video/webm');
      assert.equal((await webmRange.arrayBuffer()).byteLength,16);
      const webmHead = await request(portrait.src,{auth:false,method:'HEAD'});
      assert.equal(webmHead.status,200); assert.equal(webmHead.headers.get('content-type'),'video/webm');
 assert.ok(publicProject.videos.every(v => v.status === 'ready' && !('sourceBytes' in v) && !('error' in v)));
      const full = await request(landscape.src, { auth: false });
      assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/mp4');
      assert.equal(full.headers.get('accept-ranges'), 'bytes'); assert.deepEqual(Buffer.from(await full.arrayBuffer()), expected);
      const head = await request(landscape.src, { method: 'HEAD', auth: false });
      assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), expected.length); assert.equal((await head.arrayBuffer()).byteLength, 0);
      for (const [range, start, end] of [['bytes=0-31',0,31], ['bytes=-17',expected.length-17,expected.length-1], ['bytes=20-',20,expected.length-1], ['bytes=0-999999999',0,expected.length-1]]) {
        const r = await request(landscape.src, { auth: false, headers: { Range: range } });
        assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes ${start}-${end}/${expected.length}`);
        assert.deepEqual(Buffer.from(await r.arrayBuffer()), expected.subarray(start, end + 1));
      }
      const rangedHead = await request(landscape.src, { method: 'HEAD', auth: false, headers: { Range: 'bytes=0-9' } });
      assert.equal(rangedHead.status, 206); assert.equal(rangedHead.headers.get('content-length'), '10'); assert.equal((await rangedHead.arrayBuffer()).byteLength, 0);
      for (const range of [`bytes=${expected.length}-`, 'bytes=50-10', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'invalid', 'bytes=999999999999999999999-']) {
        const r = await request(landscape.src, { auth: false, headers: { Range: range } });
        assert.equal(r.status, 416, range); assert.equal(r.headers.get('content-range'), `bytes */${expected.length}`);
      }
      assert.equal((await request(endpoint, { method: 'PATCH', body: details })).status, 200);
      assert.equal((await request(landscape.src, { auth: false })).status, 404);
    });
    await t.test('video deletion is scoped to its project and removes all files', async () => {
      assert.ok(portrait?.id);
      const other = await createProject();
      assert.equal((await request(`/api/admin/projects/${other.id}/videos/${portrait.id}`, { method: 'DELETE' })).status, 404);
      assert.equal((await request(`${endpoint}/videos/${portrait.id}`, { method: 'DELETE', token: false })).status, 403);
      assert.equal((await request(`${endpoint}/videos/${portrait.id}`, { method: 'DELETE' })).status, 200);
      assert.equal((await request(portrait.src)).status, 404); await assertFiles(portrait.id, []);
      assert.ok(!(await project(p.id)).videos.some(v => v.id === portrait.id));
    });
    await t.test('caps two concurrent uploads and cleans disconnected request bodies', async () => {
      const before = new Set((await project(p.id)).videos.map(v => v.id));
      const pending = [];
      try {
        for (let i = 0; i < 2; i++) {
          const req = http.request(origin + endpoint + '/videos', { method: 'POST', agent: false, headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'video/mp4', 'Content-Length': mp4.length } });
          req.on('error', () => {}); req.write(mp4.subarray(0, 64)); pending.push(req);
        }
        let active = [];
        for (let i = 0; i < 100; i++) { active = (await project(p.id)).videos.filter(v => !before.has(v.id)); if (active.length === 2) break; await delay(20); }
        assert.equal(active.length, 2);
        assert.equal((await upload(p.id, mp4)).status, 429);
        for (const req of pending) req.destroy();
        for (let i = 0; i < 100; i++) { if ((await project(p.id)).videos.every(v => before.has(v.id))) break; await delay(20); }
        assert.ok((await project(p.id)).videos.every(v => before.has(v.id)), 'aborted upload rows are removed');
        for (const v of active) await assertFiles(v.id, []);
      } finally { for (const req of pending) req.destroy(); }
    });
    await t.test('deleting an actively uploading video or project cancels the stream and cleans the original', async () => {
      for (const deleteProject of [false, true]) {
        const separate = await createProject(), route = `/api/admin/projects/${separate.id}`;
        const req = http.request(origin + route + '/videos', { method: 'POST', agent: false, headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'video/mp4', 'Content-Length': mp4.length } });
        req.on('error', () => {}); req.write(mp4.subarray(0, 64));
        try {
          let v;
          for (let i = 0; i < 100; i++) { v = (await project(separate.id))?.videos[0]; if (v) break; await delay(20); }
          assert.ok(v); assert.equal(v.status, 'uploading');
          assert.equal((await request(deleteProject ? route : `${route}/videos/${v.id}`, { method: 'DELETE' })).status, 200);
          await assertFiles(v.id, []);
          await delay(50);
          assert.equal((await request(v.src)).status, 404);
          if (!deleteProject) { assert.equal((await project(separate.id)).videos.length, 0); await request(route, { method: 'DELETE' }); }
        } finally { req.destroy(); }
      }
    });
    await t.test('graceful shutdown waits for active transcode cleanup before exiting', async () => {
      const separate = await createProject(), longPath = path.join(fixtureDir, 'shutdown.mp4');
      await command('ffmpeg', ['-hide_banner','-loglevel','error','-stream_loop','39','-i',mp4Path,'-c','copy',longPath]);
      const v = await accepted(separate.id, await readFile(longPath), 'video/mp4', 'shutdown.mp4');
      let current;
      for (let i = 0; i < 100; i++) { current = (await project(separate.id)).videos.find(item => item.id === v.id); if (current.status === 'processing') break; assert.notEqual(current.status, 'failed'); await delay(20); }
      assert.equal(current.status, 'processing');
      await delay(100); await stop();
      assert.deepEqual(await videoFiles(v.id), [], 'all temporary files are gone when server exits');
      await start();
      assert.equal((await terminal(separate.id, v.id)).status, 'failed');
      assert.equal((await request(v.src)).status, 404);
      await request(`/api/admin/projects/${separate.id}`, { method: 'DELETE' });
    });
    await t.test('caps the combined upload and processing queue at eight', async () => {
      const db = new DatabaseSync(path.join(dataDir, 'portfolio.sqlite'));
      const ids = Array.from({ length: 8 }, () => randomUUID());
      try {
        for (const id of ids) db.prepare('INSERT INTO videos(id,project_id,name,status,input_type,created) VALUES(?,?,?,?,?,?)').run(id, p.id, 'queue fixture', 'uploading', 'video/mp4', Date.now());
        assert.equal((await upload(p.id, mp4)).status, 429);
      } finally { for (const id of ids) db.prepare('DELETE FROM videos WHERE id=?').run(id); db.close(); }
    });
    await t.test('restart removes interrupted/orphan originals and keeps ready output and complete queued jobs', async () => {
      await stop();
      const db = new DatabaseSync(path.join(dataDir, 'portfolio.sqlite'));
      const interrupted = [randomUUID(), randomUUID()], queued = randomUUID(), browserQueued = randomUUID(), browserRejected = randomUUID(), orphan = randomUUID();
      try {
        for (const [i, id] of interrupted.entries()) {
          db.prepare('INSERT INTO videos(id,project_id,name,status,input_type,created) VALUES(?,?,?,?,?,?)').run(id, p.id, 'interrupted fixture', i ? 'processing' : 'uploading', 'video/mp4', Date.now());
          for (const suffix of ['source', 'partial', 'mp4']) await writeFile(path.join(dataDir,'uploads',`video-${id}.${suffix}`), mp4);
        }
        db.prepare('INSERT INTO videos(id,project_id,name,status,input_type,created,source_bytes) VALUES(?,?,?,?,?,?,?)').run(queued, p.id, 'queued fixture', 'queued', 'video/mp4', Date.now(), mp4.length);
        await writeFile(path.join(dataDir,'uploads',`video-${queued}.source`), mp4);
        for (const [id,bytes] of [[browserQueued,await readFile(path.join(fixtureDir,'compliant.mp4'))],[browserRejected,mp4]]) {
          db.prepare('INSERT INTO videos(id,project_id,name,status,input_type,created,source_bytes,compression_mode) VALUES(?,?,?,?,?,?,?,?)').run(id,p.id,'browser restart','queued','video/mp4',Date.now(),bytes.length,'browser');
          await writeFile(path.join(dataDir,'uploads',`video-${id}.source`),bytes);
        }
        for (const id of [orphan, landscape.id]) for (const suffix of ['source', 'partial']) await writeFile(path.join(dataDir,'uploads',`video-${id}.${suffix}`), mp4);
        await writeFile(path.join(dataDir,'uploads',`video-${orphan}.mp4`), mp4);
      } finally { db.close(); }
      await start();
      for (const id of interrupted) { const v = await terminal(p.id, id); assert.equal(v.status, 'failed'); assert.ok(v.error); await assertFiles(id, []); }
      await assertFiles(orphan, []);
      assert.equal((await terminal(p.id, landscape.id)).status, 'ready');
      await assertFiles(landscape.id, [`video-${landscape.id}.mp4`]);
      assert.equal((await request(landscape.src)).status, 200);
      assert.equal((await terminal(p.id, queued)).status, 'ready');
      await assertFiles(queued, [`video-${queued}.mp4`]);
      assert.equal((await terminal(p.id,browserQueued)).status,'ready');
      await assertFiles(browserQueued,[`video-${browserQueued}.mp4`]);
      const rejected = await terminal(p.id,browserRejected);
      assert.equal(rejected.status,'failed'); assert.match(rejected.error,/服务器压缩/);
      await assertFiles(browserRejected,[]);
    });
    await t.test('deleting a project removes ready and failed records and every video file', async () => {
      const ids = (await project(p.id)).videos.map(v => v.id);
      assert.equal((await request(endpoint, { method: 'DELETE' })).status, 200);
      assert.equal(await project(p.id), undefined);
      for (const id of ids) { await assertFiles(id, []); assert.equal((await request('/api/videos/' + id)).status, 404); }
    });
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
