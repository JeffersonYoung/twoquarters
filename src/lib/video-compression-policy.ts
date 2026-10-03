// Keep these source guards aligned with server/video.mjs and server/storage.mjs.
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 600;
export const MAX_SOURCE_EDGE = 4096;
export const MAX_SOURCE_PIXELS = 8847360;
export const MAX_SOURCE_FRAME_RATE = 120;
export const VIDEO_TEMP_DIRECTORY = 'twoquarters-video-compression';
export const AUDIO_BITRATE = 128_000;
export const AUDIO_SAMPLE_RATE = 48_000;

export interface VideoSourceMetadata {
  codedWidth: number;
  codedHeight: number;
  // Display dimensions include pixel aspect ratio and orientation.
  displayWidth: number;
  displayHeight: number;
  duration: number;
  frameRate: number;
  hasAudio: boolean;
}

export function validateVideoFile(file: Pick<File, 'size' | 'type' | 'name'>): void {
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
    throw new Error('视频必须非空且不超过 250 MiB。');
  }
  if (!['video/mp4', 'video/quicktime', 'video/webm', ''].includes(file.type) ||
      !/\.(mp4|mov|webm)$/i.test(file.name)) {
    throw new Error('请选择 MP4、MOV 或 WebM 视频。');
  }
}

export function createCompressionPlan(source: VideoSourceMetadata) {
  const { codedWidth, codedHeight, displayWidth, displayHeight, duration, frameRate } = source;
  if (![codedWidth, codedHeight, displayWidth, displayHeight, duration, frameRate].every(value => Number.isFinite(value) && value > 0) ||
      !Number.isInteger(codedWidth) || !Number.isInteger(codedHeight) ||
      Math.max(codedWidth, codedHeight) > MAX_SOURCE_EDGE || codedWidth * codedHeight > MAX_SOURCE_PIXELS ||
      duration > MAX_VIDEO_SECONDS || frameRate > MAX_SOURCE_FRAME_RATE ||
      Math.min(displayWidth, displayHeight) < 2) {
    throw new Error('视频需为有效尺寸、最长 10 分钟、最高 4K / 120fps。');
  }
  const scale = Math.min(1, 1920 / Math.max(displayWidth, displayHeight), 1080 / Math.min(displayWidth, displayHeight));
  const width = Math.max(2, Math.floor(displayWidth * scale / 2) * 2);
  const height = Math.max(2, Math.floor(displayHeight * scale / 2) * 2);
  const outputFrameRate = Math.min(30, frameRate);
  // Leave room for AAC, MP4 metadata and encoder rate-control overshoot, even at 10 minutes.
  const sizeBudgetBitrate = Math.floor(MAX_VIDEO_BYTES * 8 * 0.85 / duration) - (source.hasAudio ? AUDIO_BITRATE : 0);
  const bitrate = Math.floor(Math.min(4_000_000, sizeBudgetBitrate,
    Math.max(250_000, width * height * outputFrameRate * 0.065)));
  return { width, height, frameRate: outputFrameRate, bitrate };
}

export function compressedVideoName(name: string): string {
  return `${name.replace(/\.[^.]*$/, '') || 'video'}.mp4`;
}

export function videoAbortError(): DOMException {
  return new DOMException('浏览器压缩已取消，未上传视频。', 'AbortError');
}
