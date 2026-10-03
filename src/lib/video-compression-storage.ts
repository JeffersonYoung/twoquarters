// A closed/crashed tab cannot finish asynchronous cleanup. Reclaim only our UUID
// temporary MP4s older than a day; recent files and unrelated names are skipped.
export async function cleanupStaleVideoFiles(directory: FileSystemDirectoryHandle, now = Date.now(), signal?: AbortSignal): Promise<void> {
  const iterable = directory as FileSystemDirectoryHandle & {
    values?: () => AsyncIterableIterator<FileSystemHandle>;
  };
  if (!iterable.values || signal?.aborted) return;
  const started = Date.now();
  let inspected = 0;
  for await (const entry of iterable.values()) {
    if (signal?.aborted || ++inspected > 100 || Date.now() - started >= 500) return;
    if (entry.kind !== 'file' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.mp4$/i.test(entry.name)) continue;
    try {
      const file = await (entry as FileSystemFileHandle).getFile();
      if (signal?.aborted) return;
      if (file.lastModified < now - 24 * 60 * 60 * 1000) await directory.removeEntry(entry.name);
    } catch {
      // Another tab may remove a stale entry concurrently; retry other failures next time.
    }
  }
}
