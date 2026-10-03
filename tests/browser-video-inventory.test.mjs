import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { Input, BlobSource, MP4, QTFF, WEBM } from 'mediabunny';

const cache = new Map();
async function load(name) {
  if (cache.has(name)) return cache.get(name);
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const imports = {};
  for (const match of source.matchAll(/from '\.\/([^']+)'/g)) imports[`./${match[1]}`] = await load(match[1]);
  const exports = {};
  new Function('require', 'exports', code)(specifier => imports[specifier], exports);
  cache.set(name, exports); return exports;
}
const { inspectContainerTracks, assertTrackInventory } = await load('video-compression-inventory');
const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
const box = (type, ...children) => { const payload = Buffer.concat(children); return Buffer.concat([u32(payload.length + 8), Buffer.from(type), payload]); };
const track = (id, handler) => box('trak', box('tkhd', Buffer.alloc(12), u32(id)), box('mdia', box('hdlr', Buffer.alloc(8), Buffer.from(handler))));
const mp4 = (...tracks) => new Blob([box('ftyp', Buffer.from('isom0000')), box('mdat', Buffer.alloc(64)), box('moov', ...tracks)]);
const element = (id, body) => Buffer.concat([Buffer.from(id), Buffer.from([0x80 | body.length]), body]);
const ebmlTrack = (id, type) => element([0xae], Buffer.concat([element([0xd7], Buffer.from([id])), element([0x83], Buffer.from([type]))]));
const webm = (...tracks) => new Blob([element([0x1a, 0x45, 0xdf, 0xa3], Buffer.alloc(0)),
  Buffer.from([0x18, 0x53, 0x80, 0x67, 0xff]), element([0x16, 0x54, 0xae, 0x6b], Buffer.concat(tracks))]);

test('bounded inventory reads MP4 IDs/types while skipping media bytes and rejects non-AV tracks', async () => {
  assert.deepEqual(await inspectContainerTracks(mp4(track(1, 'vide'), track(7, 'soun'))), [{ id: 1, type: 'video' }, { id: 7, type: 'audio' }]);
  for (const handler of ['sbtl', 'subt', 'text', 'tmcd', 'meta', 'xxxx']) {
    await assert.rejects(inspectContainerTracks(mp4(track(1, 'vide'), track(2, handler))), /不会自动丢弃轨道/);
  }
  await assert.rejects(inspectContainerTracks(mp4(track(1, 'vide'), track(1, 'soun'))));
  await assert.rejects(inspectContainerTracks(new Blob([box('ftyp', Buffer.from('isom0000')), u32(999), Buffer.from('moov')])));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectContainerTracks(mp4(track(1, 'vide')), controller.signal), { name: 'AbortError' });
});

test('WebM permits unknown-size Segment but rejects subtitle/unknown tracks, duplicates and unknown child sizes', async () => {
  assert.deepEqual(await inspectContainerTracks(webm(ebmlTrack(1, 1), ebmlTrack(2, 2))), [{ id: 1, type: 'video' }, { id: 2, type: 'audio' }]);
  for (const type of [0x11, 0x12, 0xff]) await assert.rejects(inspectContainerTracks(webm(ebmlTrack(1, 1), ebmlTrack(2, type))), /不会自动丢弃轨道/);
  await assert.rejects(inspectContainerTracks(webm(ebmlTrack(1, 1), ebmlTrack(1, 2))));
  await assert.rejects(inspectContainerTracks(new Blob([await webm(ebmlTrack(1, 1)).arrayBuffer(), Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0xff])])));
  assert.throws(() => assertTrackInventory([{ id: 1, type: 'video' }, { id: 2, type: 'audio' }], [{ id: 1, isVideoTrack: () => true, isAudioTrack: () => false }]), /不会自动丢弃轨道/);
});

test('metadata scan has hard read bounds and does not read an mdat payload', async () => {
  const media = new Uint8Array(1024 * 1024);
  const original = new Blob([box('ftyp', Buffer.from('isom0000')), box('mdat', media), box('moov', track(1, 'vide'))]);
  let readBytes = 0;
  const localBlob = { size: original.size, slice(start, end) { readBytes += end - start; return original.slice(start, end); } };
  await inspectContainerTracks(localBlob);
  assert.ok(readBytes < 256);
  const tooManyBoxes = new Blob([box('ftyp', Buffer.from('isom0000')), ...Array.from({ length: 4097 }, () => box('free')), box('moov', track(1, 'vide'))]);
  await assert.rejects(inspectContainerTracks(tooManyBoxes));
});

test('real MP4 mov_text regression: independently rejects the subtitle Mediabunny omits', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'twoquarters-inventory-'));
  try {
    const subtitles = path.join(directory, 'captions.srt'), file = path.join(directory, 'subtitle.mp4');
    await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:00,900\nPreserve this caption\n');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=32x32:rate=10:duration=1', '-f', 'srt', '-i', subtitles,
      '-map', '0:v', '-map', '1:s', '-c:v', 'libx264', '-threads', '1', '-c:s', 'mov_text', '-t', '1', file]);
    const ffprobe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }));
    assert.equal(ffprobe.streams.length, 2); assert.equal(ffprobe.streams[1].codec_name, 'mov_text');
    const blob = new Blob([await readFile(file)]);
    const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
    try { assert.equal((await input.getTracks()).length, 1, 'reproduce demuxer silently omitting subtitle'); }
    finally { input.dispose(); }
    await assert.rejects(inspectContainerTracks(blob), /不会自动丢弃轨道/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real ordinary MP4 and WebM inventories exactly match Mediabunny track IDs/types', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'twoquarters-inventory-av-'));
  try {
    for (const [extension, codec] of [['mp4', 'libx264'], ['webm', 'libvpx-vp9']]) {
      const file = path.join(directory, `valid.${extension}`);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=32x32:rate=10:duration=0.2', '-f', 'lavfi', '-i', 'sine=sample_rate=48000',
        '-c:v', codec, '-c:a', extension === 'mp4' ? 'aac' : 'libopus', '-t', '0.2', '-threads', '1', file]);
      const bytes = await readFile(file);
      const variants = [bytes];
      if (extension === 'webm') {
        const unknown = Buffer.from(bytes), offset = unknown.indexOf(Buffer.from([0x18, 0x53, 0x80, 0x67])) + 4;
        assert.equal(unknown[offset], 1, 'ffmpeg uses an eight-byte Segment size');
        unknown.fill(255, offset + 1, offset + 8); variants.push(unknown);
      }
      for (const bytes of variants) {
        const blob = new Blob([bytes]), input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, WEBM] });
        try { const inventory = await inspectContainerTracks(blob); assert.equal(inventory.length, 2); assertTrackInventory(inventory, await input.getTracks()); }
        finally { input.dispose(); }
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
