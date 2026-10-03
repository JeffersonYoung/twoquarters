import { compressedVideoName, MAX_VIDEO_BYTES, validateVideoFile, VIDEO_TEMP_DIRECTORY, videoAbortError } from './video-compression-policy';
import { cleanupStaleVideoFiles } from './video-compression-storage';
import type { CompressionRequest, CompressionResponse } from './video-compression-protocol';

export interface CompressedVideo {
  file: File;
  /** Call after upload settles (including failure/cancellation) to remove the local temporary file. */
  dispose: () => Promise<void>;
}

export interface CompressionOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/** Local-only compression. This module never uploads or falls back to the original file. */
export async function compressVideo(file: File, { signal, onProgress }: CompressionOptions = {}): Promise<CompressedVideo> {
  validateVideoFile(file);
  if (signal?.aborted) throw videoAbortError();
  if (!globalThis.isSecureContext || typeof Worker === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error('当前浏览器不支持安全的本地视频压缩。请使用支持 WebCodecs 和本地临时存储的浏览器，或手动选择服务器压缩。');
  }

  let directory: FileSystemDirectoryHandle;
  try {
    directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(VIDEO_TEMP_DIRECTORY, { create: true });
    await cleanupStaleVideoFiles(directory, Date.now(), signal);
  } catch {
    throw new Error('浏览器本地临时存储不可用。请检查浏览器存储设置或手动选择服务器压缩。');
  }
  if (signal?.aborted) throw videoAbortError();
  const outputName = `${crypto.randomUUID()}.mp4`;
  let worker: Worker | undefined;
  let created = false;
  let removed = false;
  let pageHidden = false;
  let stop: ((error: Error) => void) | undefined;
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (removed || !created) return Promise.resolve();
    if (disposal) return disposal;
    disposal = (async () => {
      // Termination releases a worker's file lock asynchronously in some browsers.
      for (let attempt = 0; ; attempt++) {
        try {
          await directory.removeEntry(outputName);
          removed = true;
          window.removeEventListener('pagehide', onPageHide);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'NotFoundError') {
            removed = true;
            window.removeEventListener('pagehide', onPageHide);
            return;
          }
          if (attempt === 4) throw new Error('浏览器临时视频清理失败，请清理此网站的本地存储。');
          await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
        }
      }
    })().finally(() => { disposal = undefined; });
    return disposal;
  };
  const onPageHide = () => {
    pageHidden = true;
    stop?.(videoAbortError());
    worker?.terminate();
    void dispose().catch(error => console.error(error));
  };

  try {
    const handle = await directory.getFileHandle(outputName, { create: true });
    created = true;
    window.addEventListener('pagehide', onPageHide);
    if (signal?.aborted || pageHidden) throw videoAbortError();
    worker = new Worker(new URL('./video-compression.worker.ts', import.meta.url), { type: 'module' });
    const activeWorker = worker;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let cancelTimer: ReturnType<typeof setTimeout> | undefined;
      const processingTimer = setTimeout(() => finish(new Error('浏览器视频压缩超时，已停止且未上传视频。')), 15 * 60 * 1000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (cancelTimer !== undefined) clearTimeout(cancelTimer);
        clearTimeout(processingTimer);
        stop = undefined;
        signal?.removeEventListener('abort', abort);
        activeWorker.onmessage = null;
        activeWorker.onerror = null;
        activeWorker.onmessageerror = null;
        activeWorker.terminate();
        worker = undefined;
        if (error) reject(error); else resolve();
      };
      const abort = () => {
        if (settled || cancelTimer !== undefined) return;
        try { activeWorker.postMessage({ type: 'cancel' } satisfies CompressionRequest); }
        catch { finish(videoAbortError()); return; }
        cancelTimer = setTimeout(() => finish(videoAbortError()), 1000);
      };
      activeWorker.onmessage = (event: MessageEvent<CompressionResponse>) => {
        const response = event.data;
        if (response.type === 'progress') {
          if (!signal?.aborted && Number.isFinite(response.progress)) {
            try { onProgress?.(Math.max(0, Math.min(0.99, response.progress))); }
            catch (error) { finish(error instanceof Error ? error : new Error('压缩进度回调失败。')); }
          }
        } else if (response.type === 'complete') {
          finish(signal?.aborted ? videoAbortError() : undefined);
        } else if (response.type === 'error') {
          finish(signal?.aborted || response.name === 'AbortError' ? videoAbortError() : new Error(response.message));
        }
      };
      activeWorker.onerror = event => {
        event.preventDefault();
        finish(signal?.aborted ? videoAbortError() : new Error('浏览器视频压缩工作线程失败，未上传视频。'));
      };
      activeWorker.onmessageerror = () => finish(new Error('无法读取浏览器压缩结果，未上传视频。'));
      stop = finish;
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { finish(videoAbortError()); return; }
      try {
        onProgress?.(0);
        activeWorker.postMessage({ type: 'start', file, output: handle } satisfies CompressionRequest);
      } catch { finish(new Error('无法启动浏览器视频压缩，未上传视频。')); }
    });
    if (signal?.aborted || pageHidden) throw videoAbortError();
    const output = await handle.getFile();
    if (!output.size || output.size >= MAX_VIDEO_BYTES) throw new Error('压缩输出为空或超过 250 MiB，未上传视频。');
    if (signal?.aborted || pageHidden) throw videoAbortError();
    onProgress?.(1);
    return { file: new File([output], compressedVideoName(file.name), { type: 'video/mp4', lastModified: Date.now() }), dispose };
  } catch (error) {
    worker?.terminate();
    worker = undefined;
    await dispose();
    throw error;
  }
}
