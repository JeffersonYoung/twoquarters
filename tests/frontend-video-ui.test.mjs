import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the real AdminPage upload handler with controlled effects, not a copy of its logic.
// This is a Node contract test, not a substitute for rendering and clicking the browser UI.
const source = await readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('AdminPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handlerSource, cleanupSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'uploadVideo') handlerSource = node.getText(ast);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' &&
      node.arguments[0]?.getText(ast).includes('videoAbort.current?.abort()')) cleanupSource = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handlerSource, 'AdminPage must expose its video upload handler');
assert.ok(cleanupSource, 'AdminPage must abort in-progress video work on unmount');
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const compiledHandler = compile(handlerSource);
const compiledCleanup = compile(`const createCleanup = ${cleanupSource};`);
const original = new File(['synthetic original video bytes'], 'fixture.mp4', { type: 'video/mp4' });
const compressed = new File(['compressed bytes'], 'fixture.mp4', { type: 'video/mp4' });
const project = { id: 'fixture-project', slug: 'fixture-project', title: 'Untouched draft title', images: [], videos: [] };
const abortError = () => new DOMException('fixture cancellation', 'AbortError');

function harness(overrides = {}) {
  const state = { notices: [], busy: [], tasks: [], uploads: [], loads: [], errors: [], compressions: [], disposals: 0 };
  const scope = {
    selected: structuredClone(project), locked: false, operation: { current: false }, videoMode: 'browser',
    videoInputRef: { current: { value: 'fixture.mp4' } }, videoAbort: { current: null },
    setNotice: value => state.notices.push(value), setBusy: value => state.busy.push(value), setVideoTask: value => state.tasks.push(value),
    compressVideo: async (file, options) => {
      state.compressions.push({ file, options });
      options.onProgress(0.5);
      return { file: compressed, dispose: async () => { state.disposals++; } };
    },
    uploadProjectVideo: async (selected, file, mode, signal) => { state.uploads.push({ selected, file, mode, signal }); },
    loadProjects: async slug => { state.loads.push(slug); },
    showError: (error, fallback) => { state.errors.push({ error, fallback }); },
    ...overrides,
  };
  const render = () => new Function(...Object.keys(scope), `${compiledHandler}; return uploadVideo;`)(...Object.values(scope));
  const unmount = new Function('videoAbort', `${compiledCleanup}; return createCleanup();`)(scope.videoAbort);
  return { state, scope, render, unmount };
}
const assertUnlocked = h => {
  assert.equal(h.scope.operation.current, false);
  assert.equal(h.scope.videoAbort.current, null);
  assert.equal(h.scope.videoInputRef.current.value, '');
  assert.equal(h.state.busy.at(-1), false);
  assert.equal(h.state.tasks.at(-1), null);
};
const flushUntil = async predicate => {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(predicate(), 'expected asynchronous handler stage was not reached');
};

test('video UI keeps explicit browser/server choices and server default', () => {
  assert.match(source, /useState<VideoCompressionMode>\("server"\)/);
  assert.match(source, /浏览器压缩（仅上传压缩结果）/);
  assert.match(source, /服务器处理（上传原文件）/);
  assert.match(source, /disabled=\{locked\}/);
  assert.match(source, /取消\{videoTask\.phase === "compressing" \? "压缩" : "上传"\}/);
});

test('browser upload submits only the prepared File and disposes it after the upload settles', async () => {
  const h = harness();
  await h.render()(original);
  assert.equal(h.state.uploads.length, 1);
  assert.equal(h.state.uploads[0].file, compressed);
  assert.notEqual(h.state.uploads[0].file, original);
  assert.equal(h.state.uploads[0].mode, 'browser');
  assert.ok(h.state.uploads[0].signal instanceof AbortSignal);
  assert.equal(h.state.disposals, 1);
  assert.deepEqual(h.state.loads, [project.slug]);
  assert.match(h.state.notices.at(-1).text, /视频已上传/);
  assert.ok(h.state.tasks.some(task => task?.phase === 'compressing' && task.progress === 0.5));
  assert.equal(h.scope.selected.title, project.title, 'local processing must not replace the draft');
  assertUnlocked(h);
});

test('unsupported or mid-encode failure makes zero upload calls and never changes browser mode', async t => {
  for (const message of ['unsupported encoder', 'mid-encode failure']) {
    await t.test(message, async () => {
      const h = harness({ compressVideo: async () => { throw new Error(message); } });
      // Same-file repeated attempts must remain possible after either error.
      for (let attempt = 0; attempt < 2; attempt++) {
        await h.render()(original);
        assert.equal(h.state.uploads.length, 0);
        assert.equal(h.scope.videoMode, 'browser');
        assert.equal(h.state.errors.length, 0);
        assert.match(h.state.notices.at(-1).text, /浏览器压缩失败，没有上传视频/);
        assert.match(h.state.notices.at(-1).text, /手动选择服务器处理后重新选择文件/);
        assertUnlocked(h);
      }
    });
  }
});

test('explicit server mode and a new handler invocation are required after a local failure', async () => {
  const h = harness({ compressVideo: async () => { throw new Error('unsupported encoder'); } });
  await h.render()(original);
  assert.equal(h.state.uploads.length, 0);
  h.scope.videoMode = 'server';
  assert.equal(h.state.uploads.length, 0, 'a mode change alone must not upload');
  await h.render()(original);
  assert.equal(h.state.uploads.length, 1);
  assert.equal(h.state.uploads[0].file, original);
  assert.equal(h.state.uploads[0].mode, 'server');
  assertUnlocked(h);
});

test('local cancellation and unmount make zero upload calls', async t => {
  for (const viaUnmount of [false, true]) {
    await t.test(viaUnmount ? 'unmount cleanup' : 'cancel button controller', async () => {
      const h = harness({ compressVideo: (_file, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
      }) });
      const pending = h.render()(original);
      assert.ok(h.scope.videoAbort.current);
      if (viaUnmount) h.unmount(); else h.scope.videoAbort.current.abort();
      await pending;
      assert.equal(h.state.uploads.length, 0);
      assert.match(h.state.notices.at(-1).text, /已取消本地处理，没有上传视频/);
      assertUnlocked(h);
    });
  }
});

test('abort between completed compression and upload disposes output without uploading', async () => {
  const h = harness();
  h.scope.compressVideo = async () => {
    h.scope.videoAbort.current.abort();
    return { file: compressed, dispose: async () => { h.state.disposals++; } };
  };
  await h.render()(original);
  assert.equal(h.state.uploads.length, 0);
  assert.equal(h.state.disposals, 1);
  assert.match(h.state.notices.at(-1).text, /没有上传视频/);
  assertUnlocked(h);
});

test('upload cancellation aborts the same signal, refreshes server state, and never retries', async () => {
  const h = harness();
  h.scope.uploadProjectVideo = async (selected, file, mode, signal) => {
    h.state.uploads.push({ selected, file, mode, signal });
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }));
  };
  const pending = h.render()(original);
  await flushUntil(() => h.state.uploads.length === 1);
  h.scope.videoAbort.current.abort();
  await pending;
  assert.equal(h.state.uploads.length, 1);
  assert.equal(h.state.uploads[0].signal.aborted, true);
  assert.equal(h.state.uploads[0].file, compressed);
  assert.equal(h.state.disposals, 1);
  assert.deepEqual(h.state.loads, [project.slug]);
  assert.match(h.state.notices.at(-1).text, /已停止上传请求/);
  assert.match(h.state.notices.at(-1).text, /确认服务器状态/);
  assertUnlocked(h);
});

test('double file selection starts only one operation; a later attempt works after completion', async () => {
  let finish;
  const h = harness();
  h.scope.compressVideo = (_file, options) => {
    h.state.compressions.push(options);
    return new Promise(resolve => { finish = () => resolve({ file: compressed, dispose: async () => { h.state.disposals++; } }); });
  };
  const handler = h.render();
  const pending = handler(original);
  await handler(original);
  assert.equal(h.state.compressions.length, 1);
  assert.equal(h.state.uploads.length, 0);
  finish();
  await pending;
  assert.equal(h.state.uploads.length, 1);
  const next = h.render()(original);
  assert.equal(h.state.compressions.length, 2);
  finish();
  await next;
  assert.equal(h.state.uploads.length, 2);
  assert.equal(h.state.disposals, 2);
  assertUnlocked(h);
});

test('upload errors still dispose compressed output and never fall back to the original', async () => {
  const error = new Error('synthetic network error');
  const h = harness();
  h.scope.uploadProjectVideo = async (...args) => { h.state.uploads.push(args); throw error; };
  await h.render()(original);
  assert.equal(h.state.uploads.length, 1);
  assert.equal(h.state.uploads[0][1], compressed);
  assert.equal(h.state.disposals, 1);
  assert.equal(h.state.errors[0].error, error);
  assertUnlocked(h);
});

test('invalid input fails before either local processing or upload', async () => {
  for (const file of [new File([], 'empty.mp4', { type: 'video/mp4' }), new File(['x'], 'bad.txt', { type: 'text/plain' })]) {
    const h = harness();
    await h.render()(file);
    assert.equal(h.state.compressions.length, 0);
    assert.equal(h.state.uploads.length, 0);
    assert.equal(h.scope.videoInputRef.current.value, '');
    assert.equal(h.state.notices.at(-1).error, true);
  }
});
