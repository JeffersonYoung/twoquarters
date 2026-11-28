import { useEffect, useRef, useState } from "react";
import { categoryLabels, selectableCategories } from "../data";
import { getHomeCategories, uploadCategoryCover, removeCategoryCover, type HomeCategoryConfig } from "../lib/projects";

export function HomeCategoryAdmin() {
  const [config, setConfig] = useState<HomeCategoryConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const operation = useRef(false);
  useEffect(() => { let active = true; getHomeCategories().then(value => { if (active) setConfig(value); }).catch(cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  async function run(work: () => Promise<HomeCategoryConfig>, success: string) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(""); setMessage("");
    try { setConfig(await work()); setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { operation.current = false; setBusy(false); }
  }
  return <section className="carousel-editor" aria-labelledby="category-cover-heading">
    <h2 id="category-cover-heading">栏目封面</h2>
    <p>独立于项目的首页栏目图片。上传或替换成功后立即生效，图片会等比例裁切铺满卡片。支持 JPEG、PNG、WebP，每张最大 40 MB、8000 万像素。</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => void run(getHomeCategories, "栏目封面已重新加载")}>重新加载栏目封面</button>
    {(busy || message) && <p role="status">{busy ? "正在保存栏目封面，请勿离开页面…" : message}</p>}
    {!config && !error && <p>正在加载栏目封面…</p>}
    {config && <div className="carousel-admin-grid">{selectableCategories.map(category => {
      const cover = config.covers[category];
      return <article key={category}>
        <h3>{categoryLabels[category]}</h3>
        {cover ? <img src={cover.variants[0].src} alt={`${categoryLabels[category]}栏目封面`} /> : <p>尚未设置封面</p>}
        <label>{cover ? "替换封面" : "上传封面"}<input aria-label={`${categoryLabels[category]}栏目封面上传`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 40 * 1024 * 1024) { setError("请选择不超过 40 MB 的 JPEG、PNG 或 WebP 图片"); return; }
          void run(() => uploadCategoryCover(category, config.revision, file), `${categoryLabels[category]}栏目封面已保存并生效`);
        }} /></label>
        {cover && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`清除${categoryLabels[category]}栏目封面？清除后显示纯色背景。`)) void run(() => removeCategoryCover(category, config.revision), "栏目封面已清除"); }}>清除封面</button>}
      </article>;
    })}</div>}
  </section>;
}
