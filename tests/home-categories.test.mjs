import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, unlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createHomeCategories } from '../server/home-categories.mjs';

test('category covers are independent copies, survive source removal and restart, and atomically replace with revision checks', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tq-categories-'));
  await mkdir(path.join(directory, 'uploads'));
  try {
    const bytes = await sharp({ create: { width: 1400, height: 900, channels: 3, background: 'orange' } }).jpeg().toBuffer();
    const source = '11111111-1111-4111-8111-111111111111';
    await writeFile(path.join(directory, 'uploads', source), bytes);
    let store = await createHomeCategories(directory, [
      { published: false, category: 'bts', cover: { storagePath: source } },
      { published: true, category: 'automotive', cover: { storagePath: source } },
    ]);
    let state = store.snapshot();
    assert.deepEqual(Object.keys(state.covers), ['automotive']);
    const first = state.covers.automotive.variants[0];
    assert.notEqual(first.id, source);
    assert.ok(store.allows(first.src, 'GET'));
    assert.equal(store.allows(first.src + '?x=1', 'GET'), false);
    assert.equal(store.allows(first.src, 'POST'), false);
    await unlink(path.join(directory, 'uploads', source));
    store = await createHomeCategories(directory, []);
    assert.deepEqual(store.snapshot(), state);
    assert.ok((await readFile(path.join(directory, 'uploads', first.id))).length);
    await assert.rejects(store.replace('unknown', state.revision, bytes, 'bad'), e => e.status === 404);
    await assert.rejects(store.replace('automotive', state.revision, Buffer.from('broken'), 'bad'), e => e.status === 400);
    assert.deepEqual(store.snapshot(), state);
    const results = await Promise.allSettled([
      store.replace('automotive', state.revision, bytes, 'replacement.jpg'),
      store.replace('video', state.revision, bytes, 'concurrent.jpg'),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].reason.status, 409);
    state = store.snapshot();
    assert.equal(store.allows(first.src, 'GET'), false);
    await assert.rejects(readFile(path.join(directory, 'uploads', first.id)), e => e.code === 'ENOENT');
    assert.equal(state.covers.automotive.name, 'replacement.jpg');
    assert.equal((await createHomeCategories(directory)).snapshot().revision, state.revision);
    await assert.rejects(store.remove('automotive', state.revision - 1), e => e.status === 409);
    await store.remove('automotive', state.revision);
    // Cleared covers never repopulate from projects on restart.
    store = await createHomeCategories(directory, [{ published: true, category: 'automotive', cover: { storagePath: source } }]);
    assert.deepEqual(store.snapshot().covers, {});
    assert.deepEqual(await readdir(path.join(directory, 'uploads')), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
