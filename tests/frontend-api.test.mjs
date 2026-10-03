import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
let serial = 0;
const freshClient = () => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${++serial}`);
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fixture = { id: 'test id', slug: 'test-project', images: [], title: 'Fixture' };
const draft = { title: 'Fixture', titleEn: 'Fixture', category: 'automotive', year: '2026', discipline: 'Photography', summary: '', credits: '', published: false };

test('frontend API session, mutation, and recovery contract', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  await t.test('requires an authenticated anti-CSRF token before mutations', async () => {
    const client = await freshClient();
    globalThis.fetch = async () => { throw new Error('Unauthenticated mutation must not reach fetch'); };
    await assert.rejects(client.createProject(draft), error => error instanceof client.ApiError && error.status === 401);
  });

  await t.test('login stays same-origin; JSON and multipart writes carry the token; logout clears it', async () => {
    const client = await freshClient();
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/login') return json({ admin: true, csrfToken: 'test-csrf-token' });
      if (url === '/api/admin/projects' && options.method === 'GET') return json([]);
      return json({ ok: true });
    };
    await client.login('fixture-user', 'synthetic-fixture-password');
    assert.equal(requests[0].options.headers.has('X-CSRF-Token'), false);
    assert.deepEqual(JSON.parse(requests[0].options.body), { username: 'fixture-user', password: 'synthetic-fixture-password' });
    await client.createProject(draft);
    await client.updateProject(fixture.id, draft);
    await client.setProjectCover(fixture, 'image fixture');
    await client.uploadProjectImages(fixture, [new File(['fixture'], 'fixture.jpg', { type: 'image/jpeg' })]);
    await client.deleteProjectImage(fixture, { id: 'image fixture' });
    await client.uploadProjectVideo(fixture, new File(['test video'], '测试 clip.mp4', { type: 'video/mp4' }));
    await client.deleteProjectVideo(fixture, { id: 'video fixture' });
    await client.deleteProject(fixture);
    await client.listAdminProjects();
    await client.logout();
    for (const { url, options } of requests) {
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.cache, 'no-store');
      if (options.method !== 'GET' && url !== '/api/login') assert.equal(options.headers.get('X-CSRF-Token'), 'test-csrf-token');
    }
    const upload = requests.find(({ options }) => options.body instanceof FormData);
    assert.ok(upload);
    const video = requests.find(({ options }) => options.body instanceof File);
    assert.ok(video);
    assert.equal(video.options.headers.get('Content-Type'), 'video/mp4');
    assert.equal(video.options.headers.get('X-Upload-Name'), encodeURIComponent('测试 clip.mp4'));
    assert.ok(requests.some(({ url }) => url.includes('test%20id/videos/video%20fixture')));
    assert.equal(upload.options.headers.has('Content-Type'), false, 'browser must supply the multipart boundary');
    assert.equal(upload.options.body.getAll('images').length, 1);
    assert.ok(requests.some(({ url }) => url.includes('test%20id/images/image%20fixture')));
    await assert.rejects(client.createProject(draft), error => error.status === 401);
  });

  await t.test('restores the token from a session and clears it after expiration', async () => {
    const client = await freshClient();
    let call = 0;
    globalThis.fetch = async () => ++call === 1 ? json({ admin: true, csrfToken: 'restored-token' }) : new Response(JSON.stringify({ error: 'Session expired' }), { status: 401 });
    assert.equal((await client.getSession()).admin, true);
    await assert.rejects(client.updateProject(fixture.id, draft), error => error.status === 401 && error.message === 'Session expired');
    await assert.rejects(client.createProject(draft), error => error.status === 401);
    assert.equal(call, 2);
  });

  await t.test('a stale initial session response cannot overwrite a newer login token', async () => {
    const client = await freshClient();
    let resolveSession;
    let savedToken;
    globalThis.fetch = async (url, options) => {
      if (url === '/api/session') return new Promise(resolve => { resolveSession = resolve; });
      if (url === '/api/login') return json({ admin: true, csrfToken: 'new-login-token' });
      savedToken = options.headers.get('X-CSRF-Token');
      return json({ ok: true });
    };
    const pending = client.getSession();
    await client.login('fixture-user', 'synthetic-fixture-password');
    resolveSession(json({ admin: false, csrfToken: null }));
    await pending;
    await client.createProject(draft);
    assert.equal(savedToken, 'new-login-token');
  });

  await t.test('storage is an authenticated same-origin read with abort and error support', async () => {
    const client = await freshClient();
    const controller = new AbortController();
    const fixture = { filesystem: { availableBytes: 123 }, managedFiles: null };
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/admin/storage');assert.equal(options.method, 'GET');
      assert.equal(options.cache, 'no-store');assert.equal(options.credentials, 'same-origin');
      assert.equal(options.signal, controller.signal);return json(fixture);
    };
    assert.deepEqual(await client.getStorageOverview(controller.signal), fixture);
    globalThis.fetch = async () => new Response('{"error":"unavailable"}', { status: 500 });
    await assert.rejects(client.getStorageOverview(), error => error.status === 500);
  });

  await t.test('reports non-JSON server failures without a JSON parsing crash', async () => {
    const client = await freshClient();
    globalThis.fetch = async () => new Response('Bad gateway', { status: 502 });
    await assert.rejects(client.listPublishedProjects(), error => error instanceof client.ApiError && error.status === 502);
  });
});
