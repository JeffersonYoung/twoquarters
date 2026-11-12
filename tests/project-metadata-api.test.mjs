import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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
    const db = new DatabaseSync(path.join(directory, 'portfolio.sqlite'));
    try {
      const insert = db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)');
      for (let i = 0; i < 7; i++) {
        const id = 'legacy-' + i;
        const cover = { src: '/cover.jpg', alt: 'old filename', credit: 'old caption' };
        const p = { ...draft, id, slug: id, cover, images: [cover, { src: '/second.jpg' }], credits: 'Project team', published: i !== 0 };
        insert.run(id, id, JSON.stringify(p), Number(p.published), i);
      }
    } finally { db.close(); }
    await start();
    await login();
    assert.equal((await fetch(origin+'/api/admin/home-carousel')).status,401);
    assert.equal((await request('/api/home-carousel')).status,200);
    const photo=await readFile('server/seed-images/automotive/hero-mclaren.jpg');
    const uploadHeaders={Origin:origin,Cookie:cookie,'Content-Type':'image/jpeg','X-Upload-Name':'hero.jpg'};
    assert.equal((await fetch(origin+'/api/admin/home-carousel/images',{method:'POST',headers:uploadHeaders,body:photo})).status,403);
    const uploadResponse=await fetch(origin+'/api/admin/home-carousel/images',{method:'POST',headers:{...uploadHeaders,'X-CSRF-Token':csrf},body:photo});
    assert.equal(uploadResponse.status,201);
    let carousel=await uploadResponse.json();
    const imageUri=carousel.slides[0].variants[0].src;
    assert.equal((await fetch(origin+imageUri)).status,404);
    carousel=await (await request('/api/admin/home-carousel','PATCH',{...carousel,slides:carousel.slides.map(s=>({...s,enabled:true}))})).json();
    assert.equal((await fetch(origin+imageUri)).status,200);
    const authHeaders={'X-TQ-Original-Uri':imageUri,'X-TQ-Original-Method':'GET'};
    assert.equal((await fetch(origin+'/api/cdn-auth',{headers:authHeaders})).status,200);
    const removedSlide=await request('/api/admin/home-carousel/images/'+carousel.slides[0].id,'DELETE',{revision:carousel.revision});
    assert.equal(removedSlide.status,200);
    assert.equal((await fetch(origin+'/api/cdn-auth',{headers:authHeaders})).status,403);
    assert.equal((await fetch(origin+imageUri)).status,404);
    const [legacy] = await (await request('/api/projects')).json();
    assert.deepEqual(legacy.cover, { src: '/cover.jpg' });
    assert.deepEqual(legacy.images, [legacy.cover, { src: '/second.jpg' }]);
    assert.equal(legacy.credits, 'Project team');
    assert.equal((await request('/api/admin/projects/'+legacy.id,'PATCH',legacy)).status,200);
    const featuredIds = async () => (await (await request('/api/projects')).json()).filter(p => p.featured).map(p => p.id);
    assert.deepEqual(await featuredIds(), ['legacy-1','legacy-2','legacy-3','legacy-4']);
    for (const i of [5, 6]) {
      const change = await request('/api/admin/projects/legacy-' + i, 'PATCH', { ...draft, published: true, featured: true });
      assert.equal(change.status, 200);
    }
    assert.equal((await featuredIds()).length, 6);
    const publishRoute = '/api/admin/projects/legacy-0';
    const published = await (await request(publishRoute, 'PATCH', { ...draft, published: true })).json();
    assert.ok(Number.isSafeInteger(published.publishedAt));
    const edited = await (await request(publishRoute, 'PATCH', { ...draft, published: true, publishedAt: 1 })).json();
    assert.equal(edited.publishedAt, published.publishedAt);
    await request(publishRoute, 'PATCH', { ...draft, published: false });
    await delay(5);
    const republished = await (await request(publishRoute, 'PATCH', { ...draft, published: true })).json();
    assert.ok(republished.publishedAt > published.publishedAt);
    const removed = await request('/api/admin/projects/legacy-1', 'PATCH', { ...draft, published: true, featured: false });
    assert.equal(removed.status, 200);
    const response = await request('/api/admin/projects', 'POST', draft);
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.ok(Number.isSafeInteger(created.createdAt));
    assert.equal(created.shotAt,created.createdAt);
    assert.equal(created.updatedAt,created.createdAt);
    assert.equal(created.featured, false);
    assert.equal(created.productionCompany, 'Twoquarters');
    for (const key of ['brand', 'agency', 'photographer', 'retouchTeam']) assert.equal(created[key], '');
    const route = `/api/admin/projects/${created.id}`;
    const metadata = { brand: 'HUAWEI & STELATO S9', agency: 'Ogilvy', photographer: 'Kai-Uwe Gundlach', retouchTeam: 'Twoquarters & YIXIU' };
    const update = await request(route, 'PATCH', { ...draft, ...metadata, brand: ` ${metadata.brand} `, productionCompany: 'Override' });
    assert.equal(update.status, 200);
    const saved = await update.json();
    assert.equal(saved.createdAt,created.createdAt);
    assert.equal(saved.shotAt,created.shotAt);
    assert.ok(saved.updatedAt>=created.updatedAt);
    const shotAt=Date.parse('2023-08-15T04:30:00Z');
    const shooting=await (await request(route,'PATCH',{...draft,shotAt,createdAt:1,updatedAt:1})).json();
    assert.equal(shooting.shotAt,shotAt);
    assert.equal(shooting.createdAt,created.createdAt);
    assert.ok(shooting.updatedAt>1);
    for(const invalid of [null,'2023-08-15',-1,1.5,253402300800000]) assert.equal((await request(route,'PATCH',{...draft,shotAt:invalid})).status,400);
    for (const [key, value] of Object.entries(metadata)) assert.equal(saved[key], value);
    assert.equal(saved.productionCompany, 'Twoquarters');
    const unrelatedUpdate = await request(route, 'PATCH', { ...draft, summary: 'Only update the introduction' });
    assert.equal(unrelatedUpdate.status, 200);
    const preserved = await unrelatedUpdate.json();
    assert.equal(preserved.shotAt,shotAt);
    for (const [key, value] of Object.entries(metadata)) assert.equal(preserved[key], value);
    assert.equal((await request(route, 'PATCH', { ...draft, agency: 123 })).status, 400);
    assert.equal((await request(route, 'PATCH', { ...draft, brand: 'x'.repeat(201) })).status, 400);
    await stop();
    await start();
    await login();
    assert.deepEqual(await featuredIds(), ['legacy-2','legacy-3','legacy-4','legacy-5','legacy-6']);
    const persisted = (await (await request('/api/admin/projects')).json()).find(item => item.id === created.id);
    assert.equal(persisted.shotAt,shotAt);
    assert.equal(persisted.createdAt,created.createdAt);
    for (const [key, value] of Object.entries(metadata)) assert.equal(persisted[key], value);
    assert.equal(persisted.productionCompany, 'Twoquarters');
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
