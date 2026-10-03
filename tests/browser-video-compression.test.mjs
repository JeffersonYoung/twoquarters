import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../src/lib/', import.meta.url));
function loadModule(name, globals = {}, overrides = {}) {
  const cache = new Map();
  const context = vm.createContext({ console, Error, File, Blob, DOMException, URL, AbortController,
    setTimeout, clearTimeout, Uint8Array, WritableStream, ...globals });
  function load(name) {
    if (overrides[name]) return overrides[name];
    if (cache.has(name)) return cache.get(name);
    const source = readFileSync(`${root}${name}.ts`, 'utf8').replaceAll('import.meta.url', JSON.stringify(`file://${root}${name}.ts`));
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const exports = {};
    cache.set(name, exports);
    vm.runInContext(`(function(require, exports) { ${code}\n})`, context)(specifier => {
      if (overrides[specifier]) return overrides[specifier];
      if (specifier.startsWith('./')) return load(specifier.slice(2));
      throw new Error(`Unexpected dependency ${specifier}`);
    }, exports);
    return exports;
  }
  return load(name);
}
const policy = loadModule('video-compression-policy');
const source = { codedWidth: 3840, codedHeight: 2160, displayWidth: 3840, displayHeight: 2160,
  duration: 60, frameRate: 60, hasAudio: true };
const mediaFile = () => new File([new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 0, 0, 0, 0, 0, 0, 0, 0])], 'input.mov', { type: 'video/quicktime' });

test('browser policy caps landscape/portrait/square correctly with even square-pixel output and no upscale', () => {
  assert.deepEqual({ ...policy.createCompressionPlan(source) }, { width: 1920, height: 1080, frameRate: 30, bitrate: 4_000_000 });
  const portrait = policy.createCompressionPlan({ ...source, displayWidth: 2160, displayHeight: 3840 });
  assert.equal(portrait.width, 1080); assert.equal(portrait.height, 1920);
  const square = policy.createCompressionPlan({ ...source, displayWidth: 2160, displayHeight: 2160 });
  assert.equal(square.width, 1080); assert.equal(square.height, 1080);
  const small = policy.createCompressionPlan({ ...source, codedWidth: 321, codedHeight: 241, displayWidth: 321, displayHeight: 241, frameRate: 12 });
  assert.equal(small.width, 320); assert.equal(small.height, 240); assert.equal(small.frameRate, 12);
  const anamorphic = policy.createCompressionPlan({ ...source, codedWidth: 720, codedHeight: 576, displayWidth: 1024, displayHeight: 576 });
  assert.equal(anamorphic.width, 1024); assert.equal(anamorphic.height, 576);
});

test('browser source guards reject invalid values, over 4K/120fps/10min and oversized files', () => {
  for (const override of [{ duration: 0 }, { duration: 601 }, { frameRate: 0 }, { frameRate: 121 },
    { codedWidth: 4097 }, { codedWidth: 4096, codedHeight: 2161 }, { displayWidth: NaN }, { displayHeight: Infinity }]) {
    assert.throws(() => policy.createCompressionPlan({ ...source, ...override }));
  }
  for (const file of [{ size: 0, type: 'video/mp4', name: 'x.mp4' },
    { size: policy.MAX_VIDEO_BYTES + 1, type: 'video/mp4', name: 'x.mp4' },
    { size: 1, type: 'text/html', name: 'x.mp4' }, { size: 1, type: '', name: 'x.m3u8' }]) {
    assert.throws(() => policy.validateVideoFile(file));
  }
  assert.doesNotThrow(() => policy.validateVideoFile({ size: policy.MAX_VIDEO_BYTES, type: '', name: 'x.MOV' }));
  const long = policy.createCompressionPlan({ ...source, duration: 600 });
  assert.ok((long.bitrate + policy.AUDIO_BITRATE) * 600 / 8 < policy.MAX_VIDEO_BYTES * 0.86);
  assert.equal(policy.compressedVideoName('my.clip.MOV'), 'my.clip.mp4');
});

function wrapperFixture({ response = 'complete', outputSize = 32, insecure = false, constructorFails = false, storageFails = false } = {}) {
  const window = new EventTarget();
  const files = new Map();
  const workers = [];
  const timers = new Map();
  let timerId = 0, removed = 0, networkCalls = 0;
  const directory = {
    async getFileHandle(name) {
      const handle = { async getFile() { return new File([new Uint8Array(outputSize)], name, { type: '' }); } };
      files.set(name, handle); return handle;
    },
    async removeEntry(name) { removed++; files.delete(name); },
  };
  class Worker {
    constructor(url, options) {
      if (constructorFails) throw new Error('worker unavailable');
      assert.match(url.pathname, /video-compression.worker.ts$/);
      assert.equal(options.type, 'module');
      this.messages = []; this.terminated = false; workers.push(this);
    }
    terminate() { this.terminated = true; }
    postMessage(message) {
      this.messages.push(message);
      if (message.type === 'cancel') queueMicrotask(() => this.onmessage?.({ data: { type: 'error', name: 'AbortError', message: 'canceled' } }));
      else if (response === 'complete') queueMicrotask(() => this.onmessage?.({ data: { type: 'complete' } }));
      else if (response === 'unsupported') queueMicrotask(() => this.onmessage?.({ data: { type: 'error', name: 'Error', message: 'unsupported codec' } }));
      else if (response === 'workerError') queueMicrotask(() => this.onerror?.({ preventDefault() {} }));
      else if (response === 'messageError') queueMicrotask(() => this.onmessageerror?.({}));
      else if (response === 'postError') throw new Error('Cannot clone');
    }
  }
  const helper = loadModule('video-compression', {
    Worker, window, isSecureContext: !insecure, crypto: { randomUUID: () => '01234567-89ab-4cde-8fab-0123456789ab' },
    navigator: { storage: { async getDirectory() {
      if (storageFails) throw new Error('quota');
      return { async getDirectoryHandle(name) { assert.equal(name, policy.VIDEO_TEMP_DIRECTORY); return directory; } };
    } } },
    fetch() { networkCalls++; throw new Error('must not upload'); },
    setTimeout(callback, milliseconds) { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { ...helper, window, workers, files, timers, get removed() { return removed; }, get networkCalls() { return networkCalls; } };
}
const spin = async predicate => { for (let i = 0; i < 20 && !predicate(); i++) await Promise.resolve(); assert.ok(predicate()); };

test('wrapper returns only the new MP4 and retains OPFS until idempotent disposal after upload', async () => {
  const env = wrapperFixture();
  const original = mediaFile();
  const progress = [];
  const result = await env.compressVideo(original, { onProgress: fraction => progress.push(fraction) });
  assert.notEqual(result.file, original);
  assert.equal(result.file.type, 'video/mp4'); assert.equal(result.file.name, 'input.mp4'); assert.equal(result.file.size, 32);
  assert.deepEqual(progress, [0, 1]); assert.equal(env.files.size, 1); assert.equal(env.workers[0].terminated, true);
  await Promise.all([result.dispose(), result.dispose()]); await result.dispose();
  assert.equal(env.files.size, 0); assert.equal(env.removed, 1); assert.equal(env.timers.size, 0); assert.equal(env.networkCalls, 0);
});

test('unsupported, worker/message/clone/constructor failures clean temporary files and never return or upload original', async () => {
  for (const options of [{ response: 'unsupported' }, { response: 'workerError' }, { response: 'messageError' },
    { response: 'postError' }, { constructorFails: true }, { insecure: true }, { storageFails: true }, { outputSize: 0 }]) {
    const env = wrapperFixture(options);
    await assert.rejects(env.compressVideo(mediaFile()));
    assert.equal(env.files.size, 0); assert.equal(env.networkCalls, 0); assert.equal(env.timers.size, 0);
    assert.ok(env.workers.every(worker => worker.terminated));
  }
});

test('cancel before start and during compression stops worker, rejects AbortError, and cleans file', async () => {
  const env = wrapperFixture({ response: 'pending' });
  const preAbort = new AbortController(); preAbort.abort();
  await assert.rejects(env.compressVideo(mediaFile(), { signal: preAbort.signal }), { name: 'AbortError' });
  assert.equal(env.workers.length, 0);
  const controller = new AbortController();
  const job = env.compressVideo(mediaFile(), { signal: controller.signal });
  await spin(() => env.workers.length === 1 && env.workers[0].messages.length === 1);
  controller.abort();
  await assert.rejects(job, { name: 'AbortError' });
  assert.equal(env.workers[0].messages[1].type, 'cancel');
  assert.equal(env.workers[0].terminated, true); assert.equal(env.files.size, 0); assert.equal(env.timers.size, 0);
});

test('pagehide cancels the pending promise so bfcache restore cannot retain a stuck job', async () => {
  const env = wrapperFixture({ response: 'pending' });
  const job = env.compressVideo(mediaFile());
  await spin(() => env.workers.length === 1 && env.workers[0].messages.length === 1);
  env.window.dispatchEvent(new Event('pagehide'));
  await assert.rejects(job, { name: 'AbortError' });
  assert.equal(env.workers[0].terminated, true); assert.equal(env.files.size, 0); assert.equal(env.timers.size, 0);
});

test('processing watchdog terminates a hung encoder without upload', async () => {
  const env = wrapperFixture({ response: 'pending' });
  const job = env.compressVideo(mediaFile());
  await spin(() => env.timers.size === 1);
  const timer = [...env.timers.values()][0]; assert.equal(timer.milliseconds, 15 * 60 * 1000); timer.callback();
  await assert.rejects(job, /超时/);
  assert.equal(env.workers[0].terminated, true); assert.equal(env.files.size, 0); assert.equal(env.timers.size, 0); assert.equal(env.networkCalls, 0);
});

test('throwing progress callbacks clean up and cannot leave abort listeners or timers active', async () => {
  const env = wrapperFixture();
  const controller = new AbortController();
  await assert.rejects(env.compressVideo(mediaFile(), { signal: controller.signal, onProgress() { throw new Error('callback'); } }));
  controller.abort();
  assert.equal(env.files.size, 0); assert.equal(env.timers.size, 0); assert.equal(env.workers[0].messages.length, 0);
});

function coreFixture({ audio = true, decodeSupported = true, videoSupported = true, audioSupported = true,
  discard = false, oversizedWrite = false, loseOutputAudio = false, omittedInputAudio = false } = {}) {
  const state = { inputsDisposed: 0, createWritable: 0, diskWrites: 0, diskClosed: 0, diskAborted: 0,
    conversionCanceled: 0, outputCanceled: 0, networkCalls: 0, videoChecks: [], audioChecks: [] };
  const videoTrack = { id: 1,
    isVideoTrack: () => true, isAudioTrack: () => false, canDecode: async () => decodeSupported,
    getCodedWidth: async () => 320, getCodedHeight: async () => 240,
    getDisplayWidth: async () => 320, getDisplayHeight: async () => 240,
    getCodec: async () => 'avc', getRotation: async () => 0, getFlip: async () => false,
    getPixelAspectRatio: async () => ({ num: 1, den: 1 }),
    computePacketStats: async () => ({ packetCount: 30, averagePacketRate: 30, averageBitrate: 250_000 }),
  };
  const audioTrack = { id: 2,
    isVideoTrack: () => false, isAudioTrack: () => true, canDecode: async () => decodeSupported,
    getCodec: async () => 'aac', getNumberOfChannels: async () => 2, getSampleRate: async () => 48000,
    computeDuration: async () => 1,
    computePacketStats: async () => ({ packetCount: 47, averagePacketRate: 47, averageBitrate: 128_000 }),
  };
  const tracks = [videoTrack, ...(audio ? [audioTrack] : [])];
  let inputs = 0;
  class Input {
    constructor() { this.result = inputs++ > 0; }
    async getTracks() { return this.result && loseOutputAudio ? [videoTrack] : tracks; }
    async computeDuration() { return 1; }
    async getFirstTimestamp() { return 0; }
    dispose() { state.inputsDisposed++; }
  }
  class Output {
    constructor(config) { this.target = config.target; this.state = 'pending'; }
    async cancel() { state.outputCanceled++; this.state = 'canceled'; }
  }
  const library = {
    Input, Output, MP4: {}, QTFF: {}, WEBM: {},
    BlobSource: class { constructor(blob, options) { assert.equal(options.maxCacheSize, 8 * 1024 * 1024); assert.ok(blob instanceof Blob); } },
    Mp4OutputFormat: class { constructor(options) { assert.equal(options.fastStart, false); } },
    StreamTarget: class { constructor(stream, options) { this.stream = stream; assert.equal(options.chunkSize, 1024 * 1024); } },
    Quality: class { constructor(options) { this.options = options; } },
    async canEncodeVideo(codec, config) { state.videoChecks.push({ codec, config }); return videoSupported; },
    async canEncodeAudio(codec, config) { state.audioChecks.push({ codec, config }); return audioSupported; },
    Conversion: { async init(config) {
      state.conversionOptions = config;
      const conversion = {
        isValid: true, discardedTracks: discard ? [{ track: audioTrack, reason: 'undecodable_source_codec' }] : [],
        utilizedTracks: discard ? [videoTrack] : tracks, state: 'idle',
        async cancel() { state.conversionCanceled++; this.state = 'canceled'; },
        async execute() {
          this.state = 'executing';
          conversion.onProgress?.(0.5);
          const writer = config.output.target.stream.getWriter();
          try {
            await writer.write({ type: 'write', position: oversizedWrite ? policy.MAX_VIDEO_BYTES - 1 : 0, data: new Uint8Array(32) });
            await writer.close(); this.state = 'done'; config.output.state = 'finalized';
          } finally { writer.releaseLock(); }
        },
      };
      return conversion;
    } },
  };
  const handle = {
    async createWritable() {
      state.createWritable++;
      return { async write() { state.diskWrites++; }, async close() { state.diskClosed++; }, async abort() { state.diskAborted++; } };
    },
    async getFile() { return new File([new Uint8Array(32)], 'output.mp4', { type: 'video/mp4' }); },
  };
  const core = loadModule('video-compression-core', {
    VideoEncoder: class {}, VideoDecoder: class {}, AudioEncoder: class {}, OffscreenCanvas: class {},
    fetch() { state.networkCalls++; throw new Error('must not upload'); },
  }, { mediabunny: library, './video-compression-inventory': {
    ...loadModule('video-compression-inventory'),
    async inspectContainerTracks() { return [
      { id: 1, type: 'video' }, ...(audio ? [{ id: 2, type: 'audio' }] : []),
      ...(omittedInputAudio ? [{ id: 3, type: 'audio' }] : []),
    ]; },
  } });
  return { ...core, state, handle };
}
const coreOptions = () => ({ signal: new AbortController().signal, onProgress() {} });

test('core checks actual source decoder support and exact output encoder configs before creating a stream', async () => {
  for (const options of [{ decodeSupported: false }, { videoSupported: false }, { audioSupported: false }]) {
    const env = coreFixture(options);
    await assert.rejects(env.runVideoCompression(mediaFile(), env.handle, coreOptions()), /浏览器/);
    assert.equal(env.state.createWritable, 0); assert.equal(env.state.inputsDisposed, 1); assert.equal(env.state.networkCalls, 0);
  }
  const env = coreFixture();
  await env.runVideoCompression(mediaFile(), env.handle, coreOptions());
  const video = env.state.videoChecks[0], audio = env.state.audioChecks[0];
  assert.equal(video.codec, 'avc'); assert.equal(video.config.width, 320); assert.equal(video.config.height, 240);
  assert.equal(video.config.frameRate, 30); assert.equal(video.config.quality.options.bitrate, 250_000);
  assert.equal(audio.codec, 'aac'); assert.equal(audio.config.numberOfChannels, 2); assert.equal(audio.config.sampleRate, 48000);
  assert.equal(audio.config.quality.options.bitrate, 128_000);
  assert.equal(env.state.conversionOptions.copy, false);
  assert.equal(env.state.conversionOptions.video.allowTransformationMetadata, false);
  assert.equal(env.state.diskClosed, 1); assert.equal(env.state.inputsDisposed, 2); assert.equal(env.state.networkCalls, 0);
});

test('core rejects discarded input audio, lost output audio and a streamed size overflow with cleanup', async () => {
  for (const options of [{ discard: true }, { loseOutputAudio: true }, { oversizedWrite: true }]) {
    const env = coreFixture(options);
    await assert.rejects(env.runVideoCompression(mediaFile(), env.handle, coreOptions()));
    assert.ok(env.state.inputsDisposed >= 1); assert.equal(env.state.networkCalls, 0);
    if (options.oversizedWrite) {
      assert.equal(env.state.diskWrites, 0); assert.equal(env.state.diskAborted, 1); assert.equal(env.state.conversionCanceled, 1);
    }
    if (options.discard) assert.equal(env.state.diskAborted, 1);
  }
});

test('silent video never requires AAC and corrupt container content fails before demuxing', async () => {
  const env = coreFixture({ audio: false, audioSupported: false });
  await env.runVideoCompression(mediaFile(), env.handle, coreOptions());
  assert.equal(env.state.audioChecks.length, 0);
  await assert.rejects(env.runVideoCompression(new File(['not video'], 'x.mp4', { type: 'video/mp4' }), env.handle, coreOptions()), /视频内容/);
  assert.equal(env.state.createWritable, 1); assert.equal(env.state.networkCalls, 0);
});

test('crash recovery only reclaims old files in our own UUID temporary namespace', async () => {
  const { cleanupStaleVideoFiles } = loadModule('video-compression-storage');
  const now = Date.now();
  const old = '00000000-0000-4000-8000-000000000001.mp4';
  const recent = '00000000-0000-4000-8000-000000000002.mp4';
  const unrelated = 'user-video.mp4';
  const removed = [];
  const directory = {
    async *values() {
      for (const [name, lastModified] of [[old, now - 2 * 86400000], [recent, now - 60_000], [unrelated, now - 2 * 86400000]]) {
        yield { name, kind: 'file', async getFile() { return { lastModified }; } };
      }
    },
    async removeEntry(name) { removed.push(name); },
  };
  await cleanupStaleVideoFiles(directory, now);
  assert.deepEqual(removed, [old]);
});

test('stale cleanup bounds directory inspection and respects cancellation before deleting', async () => {
  const { cleanupStaleVideoFiles } = loadModule('video-compression-storage');
  const controller = new AbortController();
  let reads = 0, removes = 0;
  const directory = {
    async *values() {
      for (let i = 0; i < 1000; i++) yield {
        name: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}.mp4`, kind: 'file',
        async getFile() { reads++; return { lastModified: 0 }; },
      };
    },
    async removeEntry() { removes++; },
  };
  await cleanupStaleVideoFiles(directory, Date.now(), controller.signal);
  assert.equal(reads, 100); assert.equal(removes, 100);
  controller.abort();
  await cleanupStaleVideoFiles(directory, Date.now(), controller.signal);
  assert.equal(reads, 100); assert.equal(removes, 100);
});

test('core rejects an unknown input audio track omitted by the demuxer before any encoding', async () => {
  const env = coreFixture({ omittedInputAudio: true });
  await assert.rejects(env.runVideoCompression(mediaFile(), env.handle, coreOptions()), /不会自动丢弃轨道/);
  assert.equal(env.state.createWritable, 0); assert.equal(env.state.videoChecks.length, 0);
  assert.equal(env.state.networkCalls, 0); assert.equal(env.state.inputsDisposed, 1);
});
