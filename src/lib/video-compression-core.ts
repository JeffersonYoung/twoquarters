import {
  BlobSource, canEncodeAudio, canEncodeVideo, Conversion, Input, MP4, Mp4OutputFormat,
  Output, QTFF, Quality, StreamTarget, WEBM,
} from 'mediabunny';
import type { InputAudioTrack, InputVideoTrack, StreamTargetChunk } from 'mediabunny';
import {
  AUDIO_BITRATE, AUDIO_SAMPLE_RATE, createCompressionPlan, MAX_VIDEO_BYTES,
  validateVideoFile, videoAbortError,
} from './video-compression-policy';

import { assertTrackInventory, inspectContainerTracks } from './video-compression-inventory';

interface CoreOptions {
  signal: AbortSignal;
  onProgress: (progress: number) => void;
}

// Explicit local demuxers: no playlists, URL source, external codecs or runtime downloads.
const formats = [MP4, QTFF, WEBM];
const source = (file: Blob) => new BlobSource(file, { maxCacheSize: 8 * 1024 * 1024 });
const unsupported = (detail: string) => new Error(`${detail}，未上传视频。可换用支持的浏览器或手动选择服务器压缩。`);

async function requireDecoder(track: InputVideoTrack | InputAudioTrack): Promise<void> {
  // canDecode uses this actual track's decoder configuration, including its codec description.
  // No custom codec extensions are registered, so compressed codecs use native WebCodecs.
  if (!(await track.canDecode())) throw unsupported(`浏览器无法解码此视频的${track.isVideoTrack() ? '画面' : '音频'}`);
}

/** Runs only in the dedicated worker. No original/output file is loaded into a whole-file buffer. */
export async function runVideoCompression(file: File, fileHandle: FileSystemFileHandle, { signal, onProgress }: CoreOptions): Promise<void> {
  validateVideoFile(file);
  const checkCanceled = () => { if (signal.aborted) throw videoAbortError(); };
  checkCanceled();
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw unsupported('此浏览器不支持工作线程中的 WebCodecs 视频压缩');
  }
  const magic = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isMp4 = magic.length >= 8 && String.fromCharCode(...magic.slice(4, 8)) === 'ftyp';
  const isWebm = magic.length >= 4 && magic[0] === 0x1a && magic[1] === 0x45 && magic[2] === 0xdf && magic[3] === 0xa3;
  if (!isMp4 && !isWebm) throw new Error('视频内容不是有效的 MP4、MOV 或 WebM，未上传视频。');

  const inventory = await inspectContainerTracks(file, signal);
  checkCanceled();
  const input = new Input({ source: source(file), formats });
  let output: Output | undefined;
  let conversion: Conversion | undefined;
  let writable: FileSystemWritableFileStream | undefined;
  let writableClosed = false;
  const cancel = () => {
    if (conversion) void conversion.cancel().catch(() => {});
    else input.dispose();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    checkCanceled();
    const tracks = await input.getTracks();
    assertTrackInventory(inventory, tracks);
    const videos = tracks.filter(track => track.isVideoTrack());
    const audios = tracks.filter(track => track.isAudioTrack());
    // Never silently discard extra media, subtitles or an unsupported audio track.
    if (videos.length !== 1 || audios.length > 1 || tracks.length !== videos.length + audios.length) {
      throw unsupported('浏览器压缩仅支持一个视频轨及最多一个音轨，不会自动丢弃其他轨道');
    }
    const video = videos[0];
    const audio = audios[0];
    const [codedWidth, codedHeight, displayWidth, displayHeight, duration, stats, firstTimestamp] = await Promise.all([
      video.getCodedWidth(), video.getCodedHeight(), video.getDisplayWidth(), video.getDisplayHeight(),
      input.computeDuration(), video.computePacketStats(), input.getFirstTimestamp(),
    ]);
    checkCanceled();
    const plan = createCompressionPlan({ codedWidth, codedHeight, displayWidth, displayHeight,
      duration, frameRate: stats.averagePacketRate, hasAudio: !!audio });
    await requireDecoder(video);
    if (audio) {
      if (typeof AudioEncoder === 'undefined') throw unsupported('浏览器不能编码 AAC 音频，因此无法保留原音轨');
      await requireDecoder(audio);
    }
    checkCanceled();
    const videoQuality = new Quality({ bitrate: plan.bitrate, bitrateMode: 'constant' });
    const audioQuality = new Quality({ bitrate: AUDIO_BITRATE, bitrateMode: 'constant' });
    if (!(await canEncodeVideo('avc', { width: plan.width, height: plan.height, frameRate: plan.frameRate, quality: videoQuality }))) {
      throw unsupported('浏览器不能以此视频的尺寸、帧率和码率编码 H.264');
    }
    if (audio && !(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE, quality: audioQuality }))) {
      throw unsupported('浏览器不能编码 48 kHz 双声道 AAC，因此无法保留原音轨');
    }
    checkCanceled();
    if (typeof fileHandle.createWritable !== 'function') throw unsupported('浏览器不支持流式本地临时文件');
    writable = await fileHandle.createWritable();
    const disk = writable;
    // Honor backpressure and byte offsets, and reject before a write exceeds the upload ceiling.
    const stream = new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        checkCanceled();
        if (!Number.isSafeInteger(chunk.position) || chunk.position < 0 || chunk.position + chunk.data.byteLength >= MAX_VIDEO_BYTES) {
          throw new Error('压缩输出将超过 250 MiB，已停止且未上传视频。');
        }
        await disk.write(chunk);
      },
      async close() { await disk.close(); writableClosed = true; },
      async abort(reason) { await disk.abort(reason); writableClosed = true; },
    });
    output = new Output({
      // End metadata keeps muxing bounded; the server's lightweight remux adds fast-start.
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(stream, { chunked: true, chunkSize: 1024 * 1024 }),
    });
    conversion = await Conversion.init({
      input, output, tracks: 'all', copy: false, tags: {}, showWarnings: false,
      video: {
        codec: 'avc', quality: videoQuality, width: plan.width, height: plan.height,
        frameRate: plan.frameRate, fit: 'contain', allowTransformationMetadata: false,
        forceTranscode: true, keyFrameInterval: 2,
      },
      audio: { codec: 'aac', quality: audioQuality, numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE, forceTranscode: true },
    });
    checkCanceled();
    if (!conversion.isValid || conversion.discardedTracks.length || conversion.utilizedTracks.length !== tracks.length) {
      throw unsupported('浏览器无法完整保留并转换此视频的所有音视频轨道');
    }
    conversion.onProgress = progress => { checkCanceled(); onProgress(Math.min(0.97, Math.max(0, progress) * 0.97)); };
    await conversion.execute();
    checkCanceled();
    const compressed = await fileHandle.getFile();
    if (!compressed.size || compressed.size >= MAX_VIDEO_BYTES) throw new Error('压缩输出为空或超过 250 MiB，未上传视频。');
    const verified = new Input({ source: source(compressed), formats: [MP4] });
    try {
      const resultTracks = await verified.getTracks();
      const resultVideos = resultTracks.filter(track => track.isVideoTrack());
      const resultAudios = resultTracks.filter(track => track.isAudioTrack());
      if (resultVideos.length !== 1 || resultAudios.length !== audios.length || resultTracks.length !== tracks.length) {
        throw new Error('压缩结果丢失音视频轨道，未上传视频。');
      }
      const resultVideo = resultVideos[0];
      const [codec, width, height, rotation, flip, aspect, resultStats, resultDuration] = await Promise.all([
        resultVideo.getCodec(), resultVideo.getCodedWidth(), resultVideo.getCodedHeight(), resultVideo.getRotation(),
        resultVideo.getFlip(), resultVideo.getPixelAspectRatio(), resultVideo.computePacketStats(), verified.computeDuration(),
      ]);
      const expectedDuration = duration - Math.max(0, firstTimestamp);
      if (codec !== 'avc' || width !== plan.width || height !== plan.height || rotation !== 0 || flip || aspect.num !== aspect.den ||
          resultStats.packetCount < 1 || !Number.isFinite(resultStats.averagePacketRate) || resultStats.averagePacketRate > 30.05 ||
          !Number.isFinite(resultStats.averageBitrate) || resultStats.averageBitrate > 4_500_000 ||
          !Number.isFinite(resultDuration) || Math.abs(resultDuration - expectedDuration) > 0.25) {
        throw new Error('压缩结果未满足尺寸、码率、帧率或完整时长要求，未上传视频。');
      }
      if (audio) {
        const resultAudio = resultAudios[0];
        const [audioCodec, channels, rate, audioStats, originalAudioDuration, resultAudioDuration] = await Promise.all([
          resultAudio.getCodec(), resultAudio.getNumberOfChannels(), resultAudio.getSampleRate(), resultAudio.computePacketStats(),
          audio.computeDuration(), resultAudio.computeDuration(),
        ]);
        if (audioCodec !== 'aac' || channels !== 2 || rate !== AUDIO_SAMPLE_RATE || audioStats.packetCount < 1 ||
            !Number.isFinite(audioStats.averageBitrate) || audioStats.averageBitrate > 160_000 ||
            Math.abs(resultAudioDuration - (originalAudioDuration - Math.max(0, firstTimestamp))) > 0.25) {
          throw new Error('压缩结果音轨不完整或不符合 AAC 要求，未上传视频。');
        }
      }
    } finally { verified.dispose(); }
    checkCanceled();
    onProgress(0.99);
  } catch (error) {
    if (signal.aborted) throw videoAbortError();
    if (error instanceof Error) throw error;
    throw new Error('浏览器解码或编码失败，未上传视频。');
  } finally {
    signal.removeEventListener('abort', cancel);
    if (conversion && conversion.state !== 'done') await conversion.cancel().catch(() => {});
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    input.dispose();
    if (writable && !writableClosed) await writable.abort().catch(() => {});
  }
}
