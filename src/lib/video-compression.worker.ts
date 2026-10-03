import { runVideoCompression } from './video-compression-core';
import type { CompressionRequest, CompressionResponse } from './video-compression-protocol';

let active: AbortController | undefined;
const send = (response: CompressionResponse) => self.postMessage(response);
self.onmessage = (event: MessageEvent<CompressionRequest>) => {
  if (event.data.type === 'cancel') { active?.abort(); return; }
  if (event.data.type !== 'start' || active) return;
  const controller = new AbortController();
  active = controller;
  const { file, output } = event.data;
  void runVideoCompression(file, output, {
    signal: controller.signal,
    onProgress: progress => send({ type: 'progress', progress }),
  }).then(() => send({ type: 'complete' })).catch((error: unknown) => {
    send({ type: 'error', name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : '浏览器视频压缩失败，未上传视频。' });
  });
};
