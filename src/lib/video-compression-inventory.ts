import { videoAbortError } from './video-compression-policy';

export interface ContainerTrack { id: number; type: 'video' | 'audio' }
interface Element { id: number; start: number; end: number; unknown: boolean }
const invalid = () => new Error('无法安全读取此视频的全部轨道或容器结构，未上传视频。请手动选择服务器压缩。');
const extraTrack = () => new Error('此视频包含字幕、数据或未知轨道，浏览器压缩不会自动丢弃轨道，未上传视频。');

/** Read only bounded metadata headers, never media payloads or an entire file. */
class MetadataReader {
  private reads = 0;
  private bytes = 0;
  private started = Date.now();
  constructor(readonly blob: Blob, private signal?: AbortSignal) {}
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (this.signal?.aborted) throw videoAbortError();
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.blob.size ||
        ++this.reads > 8192 || (this.bytes += length) > 256 * 1024 || Date.now() - this.started > 10_000) throw invalid();
    const bytes = new Uint8Array(await this.blob.slice(offset, offset + length).arrayBuffer());
    if (this.signal?.aborted) throw videoAbortError();
    if (bytes.length !== length) throw invalid();
    return bytes;
  }
}
const integer = (bytes: Uint8Array): number => {
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  if (!Number.isSafeInteger(value)) throw invalid();
  return value;
};
const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const addTrack = (tracks: ContainerTrack[], id: number, type: ContainerTrack['type']) => {
  if (!Number.isSafeInteger(id) || id <= 0 || tracks.length >= 8 || tracks.some(track => track.id === id)) throw invalid();
  tracks.push({ id, type });
};

async function mp4Tracks(reader: MetadataReader): Promise<ContainerTrack[]> {
  const tracks: ContainerTrack[] = [];
  type Box = { type: string; start: number; end: number };
  const boxes = async function* (start: number, end: number): AsyncGenerator<Box> {
    let count = 0;
    while (start < end) {
      if (++count > 4096 || end - start < 8) throw invalid();
      const header = await reader.read(start, 8);
      let size = integer(header.subarray(0, 4)), headerSize = 8;
      if (size === 1) { size = integer(await reader.read(start + 8, 8)); headerSize = 16; }
      else if (size === 0) size = end - start;
      if (size < headerSize || size > end - start) throw invalid();
      yield { type: ascii(header.subarray(4, 8)), start: start + headerSize, end: start + size };
      start += size;
    }
  };
  let foundMoov = false;
  for await (const root of boxes(0, reader.blob.size)) {
    if (root.type !== 'moov') continue;
    if (foundMoov) throw invalid();
    foundMoov = true;
    for await (const box of boxes(root.start, root.end)) {
      if (box.type !== 'trak') continue;
      let id: number | undefined, handler: string | undefined;
      for await (const child of boxes(box.start, box.end)) {
        if (child.type === 'tkhd') {
          if (id !== undefined || child.end - child.start < 4) throw invalid();
          const version = (await reader.read(child.start, 1))[0];
          const offset = version === 0 ? 12 : version === 1 ? 20 : -1;
          if (offset < 0 || child.end - child.start < offset + 4) throw invalid();
          id = integer(await reader.read(child.start + offset, 4));
        } else if (child.type === 'mdia') {
          for await (const media of boxes(child.start, child.end)) {
            if (media.type !== 'hdlr') continue;
            if (handler !== undefined || media.end - media.start < 12) throw invalid();
            handler = ascii(await reader.read(media.start + 8, 4));
          }
        }
      }
      if (id === undefined || handler === undefined) throw invalid();
      if (handler !== 'vide' && handler !== 'soun') throw extraTrack();
      addTrack(tracks, id, handler === 'vide' ? 'video' : 'audio');
    }
  }
  if (!foundMoov || !tracks.length) throw invalid();
  return tracks;
}

async function webmTracks(reader: MetadataReader): Promise<ContainerTrack[]> {
  const tracks: ContainerTrack[] = [];
  const header = async (offset: number, end: number): Promise<Element> => {
    if (offset >= end) throw invalid();
    const bytes = await reader.read(offset, Math.min(12, end - offset));
    const length = (byte: number, max: number) => {
      for (let n = 1; n <= max; n++) if (byte & (1 << (8 - n))) return n;
      throw invalid();
    };
    const idLength = length(bytes[0], 4);
    if (idLength >= bytes.length) throw invalid();
    const sizeLength = length(bytes[idLength], 8);
    if (idLength + sizeLength > bytes.length) throw invalid();
    const id = integer(bytes.subarray(0, idLength));
    const mask = (1 << (8 - sizeLength)) - 1;
    let size = BigInt(bytes[idLength] & mask);
    let unknown = (bytes[idLength] & mask) === mask;
    for (let i = 1; i < sizeLength; i++) { size = size * 256n + BigInt(bytes[idLength + i]); unknown &&= bytes[idLength + i] === 255; }
    const start = offset + idLength + sizeLength;
    if (!unknown && (size > BigInt(end - start) || size > BigInt(Number.MAX_SAFE_INTEGER))) throw invalid();
    return { id, start, end: unknown ? end : start + Number(size), unknown };
  };
  const children = async function* (start: number, end: number, allowSegment = false): AsyncGenerator<Element> {
    let count = 0;
    while (start < end) {
      if (++count > 4096) throw invalid();
      const element = await header(start, end);
      // Unknown-size Segment is normal WebM. Other unknown-size structures are
      // rejected conservatively rather than guessing boundaries and dropping tracks.
      if (element.unknown && !(allowSegment && element.id === 0x18538067)) throw invalid();
      yield element;
      start = element.end;
    }
  };
  let foundSegment = false, foundTracks = false;
  for await (const root of children(0, reader.blob.size, true)) {
    if (root.id !== 0x18538067) continue;
    if (foundSegment) throw invalid();
    foundSegment = true;
    for await (const element of children(root.start, root.end)) {
      if (element.id !== 0x1654ae6b) continue;
      if (foundTracks) throw invalid();
      foundTracks = true;
      for await (const entry of children(element.start, element.end)) {
        if (entry.id === 0xec || entry.id === 0xbf) continue; // Global Void / CRC-32
        if (entry.id !== 0xae) throw invalid();
        let id: number | undefined, type: number | undefined;
        for await (const field of children(entry.start, entry.end)) {
          if (field.id !== 0xd7 && field.id !== 0x83) continue;
          if (field.end - field.start < 1 || field.end - field.start > 8) throw invalid();
          const value = integer(await reader.read(field.start, field.end - field.start));
          if (field.id === 0xd7) { if (id !== undefined) throw invalid(); id = value; }
          else { if (type !== undefined) throw invalid(); type = value; }
        }
        if (id === undefined || type === undefined) throw invalid();
        if (type !== 1 && type !== 2) throw extraTrack();
        addTrack(tracks, id, type === 1 ? 'video' : 'audio');
      }
    }
  }
  if (!foundSegment || !foundTracks || !tracks.length) throw invalid();
  return tracks;
}

export async function inspectContainerTracks(blob: Blob, signal?: AbortSignal): Promise<ContainerTrack[]> {
  const reader = new MetadataReader(blob, signal);
  const magic = await reader.read(0, Math.min(12, blob.size));
  if (magic.length >= 8 && ascii(magic.subarray(4, 8)) === 'ftyp') return mp4Tracks(reader);
  if (magic.length >= 4 && integer(magic.subarray(0, 4)) === 0x1a45dfa3) return webmTracks(reader);
  throw invalid();
}

// Mediabunny can omit unknown/subtitle tracks before getTracks() returns. Compare
// independently inventoried container IDs/types, not just its discardedTracks list.
export function assertTrackInventory(inventory: ContainerTrack[], tracks: { id: number; isVideoTrack(): boolean; isAudioTrack(): boolean }[]): void {
  if (inventory.length !== tracks.length || inventory.some(expected => !tracks.some(track => track.id === expected.id &&
      (expected.type === 'video' ? track.isVideoTrack() : track.isAudioTrack())))) throw extraTrack();
}
