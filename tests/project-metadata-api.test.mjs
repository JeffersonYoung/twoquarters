import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

test('optional project metadata is validated and persists across server restarts; production company is fixed', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tq-metadata-'));
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, DATA_DIR: directory, APP_ORIGIN: origin, PORT: String(port), NODE_ENV: 'development' };
  let server, cookie, csrf;
  const draft = { title: 'Metadata fixture', category: 'automotive' };

  async function stop() {
    if (!server) return;
    if (server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      await exited;
    }
    server = null;
  }
  async function start() {
    server = spawn(process.execPath, ['server/index.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    server.stderr.on('data', bytes => { log += bytes; });
    server.stdout.resume();
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(log);
      try { if ((await fetch(`${origin}/api/session`)).ok) return; } catch { /* Wait for the listener. */ }
      await delay(50);
    }
    throw new Error(`Server start timed out: ${log}`);
  }
  async function login() {
    const response = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'metadata-admin', password: 'Test-only-metadata-password-2026' }) });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    csrf = (await response.json()).csrfToken;
  }
  function request(route, method = 'GET', body) {
    return fetch(origin + route, { method, headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  try {
    execFileSync(process.execPath, ['scripts/database.mjs', 'init', '--maintenance'], { env });
    execFileSync(process.execPath, ['scripts/admin.mjs', 'metadata-admin', '--stdin'], { env, input: 'Test-only-metadata-password-2026\n' });
    await start();
    await login();
    const response = await request('/api/admin/projects', 'POST', draft);
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.productionCompany, 'Twoquarters');
    for (const key of ['brand', 'agency', 'photographer', 'retouchTeam']) assert.equal(created[key], '');
    const route = `/api/admin/projects/${created.id}`;
    const metadata = { brand: 'HUAWEI & STELATO S9', agency: 'Ogilvy', photographer: 'Kai-Uwe Gundlach', retouchTeam: 'Twoquarters & YIXIU' };
    const update = await request(route, 'PATCH', { ...draft, ...metadata, brand: ` ${metadata.brand} `, productionCompany: 'Override' });
    assert.equal(update.status, 200);
    const saved = await update.json();
    for (const [key, value] of Object.entries(metadata)) assert.equal(saved[key], value);
    assert.equal(saved.productionCompany, 'Twoquarters');
    const unrelatedUpdate = await request(route, 'PATCH', { ...draft, summary: 'Only update the introduction' });
    assert.equal(unrelatedUpdate.status, 200);
    const preserved = await unrelatedUpdate.json();
    for (const [key, value] of Object.entries(metadata)) assert.equal(preserved[key], value);
    assert.equal((await request(route, 'PATCH', { ...draft, agency: 123 })).status, 400);
    assert.equal((await request(route, 'PATCH', { ...draft, brand: 'x'.repeat(201) })).status, 400);
    await stop();
    await start();
    await login();
    const persisted = (await (await request('/api/admin/projects')).json()).find(item => item.id === created.id);
    for (const [key, value] of Object.entries(metadata)) assert.equal(persisted[key], value);
    assert.equal(persisted.productionCompany, 'Twoquarters');
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
