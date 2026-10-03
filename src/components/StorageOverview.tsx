import { useEffect, useRef, useState } from "react";
import { ApiError, getStorageOverview, type StorageOverview as StorageData } from "../lib/projects";

function bytes(value: number) {
 const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
 const level = value > 0 ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0;
 return `${(value / 1024 ** level).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${units[level]}`;
}

export function StorageOverview({ onAuthError }: { onAuthError: (error: unknown, fallback: string) => void }) {
 const [data, setData] = useState<StorageData | null>(null);
 const [error, setError] = useState("");
 const [loading, setLoading] = useState(true);
 const [revision, setRevision] = useState(0);
 const pending = useRef(true);
 useEffect(() => {
  const controller = new AbortController();
  let active = true;
  getStorageOverview(controller.signal).then(result => {
   if (active) { setData(result); setError(""); }
  }).catch((e: unknown) => {
   if (!active) return;
   setData(null);
   setError("暂时无法读取存储空间，请重试。");
   if (e instanceof ApiError && e.status === 401) onAuthError(e, "登录已过期");
  }).finally(() => { if (active) { setLoading(false); pending.current = false; } });
  return () => { active = false; controller.abort(); };
 }, [revision, onAuthError]);
 function refresh() {
  if (pending.current) return;
  pending.current = true; setLoading(true); setData(null); setError(""); setRevision(r => r + 1);
 }
 return <section className="storage-overview" aria-labelledby="storage-heading" aria-busy={loading}>
  <div className="storage-heading"><h2 id="storage-heading">存储空间</h2><button type="button" onClick={refresh} disabled={loading}>{loading ? "正在读取…" : "刷新空间"}</button></div>
  {error && <p role="alert">{error}</p>}
  {loading && <p role="status">正在读取当前可用空间…</p>}
  {data && <>
   <dl className="storage-stats">
    <div><dt>数据盘可用空间</dt><dd>{bytes(data.filesystem.availableBytes)}</dd></div>
    <div><dt>数据盘总容量</dt><dd>{bytes(data.filesystem.totalBytes)}</dd></div>
    <div><dt>数据盘已用空间（所有应用）</dt><dd>{bytes(data.filesystem.usedBytes)}</dd></div>
    <div><dt>本站托管文件占用（估算）</dt><dd>{data.managedFiles ? bytes(data.managedFiles.allocatedBytes) : "暂不可用"}</dd></div>
   </dl>
   <p>数据盘是网站数据目录所在文件系统；可用空间以当前进程可用量为准，可能受共享磁盘、配额或容器限制影响。系统保留空间 {bytes(data.filesystem.reservedBytes)}，因此可用量与已用量之和可能小于总容量。</p>
   <p>本站估算仅含数据库和上传目录内的普通文件（含视频处理临时文件），按已分配磁盘块计量，排除代码、备份及其他目录。扫描受限或文件变化时可能暂不可用，并非实时精确账单。</p>
   <p className={data.video.hasSpaceForNextUpload ? "" : "storage-warning"}>视频上传盘可用 {bytes(data.video.availableBytes)}；保留 {bytes(data.video.reserveBytes)}，每个活动任务另预留 {bytes(data.video.maxFileBytes * 2)}。当前 {data.video.activeJobs} 个任务，接收下一个视频至少需 {bytes(data.video.requiredBytes)} 可用空间。{data.video.hasSpaceForNextUpload ? "当前空间满足检查，实际上传时会再次检查。" : "当前空间不足，请释放空间后再上传。"}队列和并发限制仍单独适用。</p>
   <small>采样时间：{new Date(data.sampledAt).toLocaleString("zh-CN")} · 上传、压缩或删除后可刷新查看</small>
  </>}
 </section>;
}
