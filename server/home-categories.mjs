import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { uploadHomeImages, cleanupHomeImages } from './home-images.mjs';

export const categoryKeys = ['automotive', 'cg-ai', 'fmcg', 'video', 'bts'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export async function createHomeCategories(directory, initialProjects = []) {
  const filename = path.join(directory, 'home-categories.json');
  let state;
  async function persist(next) {
    const temp = filename + '.' + randomUUID() + '.tmp';
    try { await writeFile(temp, JSON.stringify(next), { flag: 'wx', mode: 0o600 }); await rename(temp, filename); state = next; }
    finally { await unlink(temp).catch(() => {}); }
  }
  try { state = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const covers = {};
    try {
      // One-time independent copies preserve the current appearance. No project IDs
      // or image references remain, so later project edits cannot change these covers.
      for (const category of categoryKeys) {
        const items = initialProjects.filter(p => p.published && p.category === category);
        const source = (items.find(p => p.featured) || items[0])?.cover;
        if (!source?.storagePath || !/^[a-f0-9-]{36}$/.test(source.storagePath)) continue;
        covers[category] = { name: '初始栏目封面', variants: await uploadHomeImages(directory, await readFile(path.join(directory, 'uploads', source.storagePath))) };
      }
      await persist({ revision: 0, covers });
    } catch (error) { await cleanupHomeImages(directory, Object.values(covers).flatMap(c => c.variants)); throw error; }
  }
  if (!Number.isSafeInteger(state.revision) || !state.covers || typeof state.covers !== 'object' || Array.isArray(state.covers)) throw Error('Invalid category cover configuration');
  let queue = Promise.resolve(), pending = 0;
  function exclusive(work) {
    if (pending >= 4) fail('栏目图片正在处理中，请稍后重试', 503);
    pending++;
    const job = queue.then(work); queue = job.catch(() => {});
    return job.finally(() => { pending--; });
  }
  function check(category, revision) {
    if (!categoryKeys.includes(category)) fail('栏目不存在', 404);
    if (revision !== state.revision) fail('栏目封面已变化，请重新加载后重试', 409);
  }
  const snapshot = () => structuredClone(state);
  const find = id => Object.values(state.covers).flatMap(c => c.variants).find(v => v.id === id);
  return {
    snapshot, find,
    allows(uri, method) { const match = typeof uri === 'string' && uri.match(/^\/api\/images\/([a-f0-9-]{36})$/); return ['GET', 'HEAD'].includes(method) && !!match && !!find(match[1]); },
    replace(category, revision, bytes, name) { return exclusive(async () => {
      check(category, revision);
      const variants = await uploadHomeImages(directory, bytes);
      const previous = state.covers[category];
      try { await persist({ revision: state.revision + 1, covers: { ...state.covers, [category]: { name: String(name || '栏目封面').slice(0, 240), variants } } }); }
      catch (error) { await cleanupHomeImages(directory, variants); throw error; }
      if (previous) await cleanupHomeImages(directory, previous.variants);
      return snapshot();
    }); },
    remove(category, revision) { return exclusive(async () => {
      check(category, revision);
      const previous = state.covers[category];
      const covers = { ...state.covers }; delete covers[category];
      await persist({ revision: state.revision + 1, covers });
      if (previous) await cleanupHomeImages(directory, previous.variants);
      return snapshot();
    }); },
  };
}
