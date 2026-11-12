import { useEffect, useRef, useState } from "react";
import { deleteHomeSlide, getHomeCarousel, saveHomeCarousel, uploadHomeSlide, type HomeCarouselConfig } from "../lib/projects";
import { Link } from "../router";

export function HomeCarouselAdmin({ logout }: { logout: () => void }) {
  const [config, setConfig] = useState<HomeCarouselConfig | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const dirty = !!config && JSON.stringify(config) !== saved;
  function accept(value: HomeCarouselConfig) { setConfig(value); setSaved(JSON.stringify(value)); }
  async function run(work: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { operation.current = false; setBusy(false); }
  }
  useEffect(() => { let active = true; getHomeCarousel().then(value => { if (active) accept(value); }).catch(cause => { if (active) setError(String(cause.message)); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  const canLeave = () => !busy && (!dirty || window.confirm("轮播设置尚未保存，确定离开？"));
  function move(index: number, direction: number) {
    if (!config) return;
    const slides = [...config.slides]; [slides[index], slides[index + direction]] = [slides[index + direction], slides[index]];
    setConfig({ ...config, slides });
  }
  async function upload(files: File[]) {
    await run(async () => {
      if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 40 * 1024 * 1024)) throw Error("请选择不超过 40 MB 的 JPEG、PNG 或 WebP 图片");
      for (let i = 0; i < files.length; i++) { setMessage(`正在上传 ${i + 1} / ${files.length}`); accept(await uploadHomeSlide(files[i])); }
      setMessage(`已上传 ${files.length} 张图片。勾选“展示”，保存后即可用于首页。`);
    });
    if (fileInput.current) fileInput.current.value = "";
  }
  return <main className="carousel-admin">
    <header className="admin-topbar"><span className="admin-brand">TWOQUARTERS <i>ADMIN</i></span><div>
      <Link to="/admin" onClick={event => { if (!canLeave()) event.preventDefault(); }}>项目管理</Link>
      <Link to="/" target="_blank">查看首页 ↗</Link>
      <button type="button" disabled={busy} onClick={() => { if (canLeave()) logout(); }}>退出</button>
    </div></header>
    <section className="carousel-editor">
      <h1>首页轮播</h1><p>按列表顺序循环展示。上传后勾选展示，调整顺序并保存生效；隐藏和删除会停止图片的公开访问。</p>
      {error && <p role="alert" className="carousel-error">{error} <button disabled={busy} onClick={() => { if (canLeave()) void run(async () => accept(await getHomeCarousel())); }}>重新加载</button></p>}
      {message && <p role="status">{message}</p>}
      {!config && !error && <p role="status">正在加载…</p>}
      {config && <>
        <div className="carousel-toolbar">
          <label>轮播间隔（秒）<input aria-label="轮播间隔（秒）" type="number" min="3" max="30" step="1" value={config.interval} disabled={busy} onChange={event => setConfig({ ...config, interval: Number(event.target.value) })} /></label>
          <button type="button" disabled={busy || dirty} onClick={() => fileInput.current?.click()}>上传图片</button>
          <input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || dirty} onChange={event => void upload(Array.from(event.target.files || []))} />
          <button type="button" disabled={busy || !config.slides.length} onClick={() => setConfig({ ...config, slides: config.slides.map(s => ({ ...s, enabled: true })) })}>全部展示</button>
          <button className="carousel-save" type="button" disabled={busy || !dirty || !Number.isInteger(config.interval) || config.interval < 3 || config.interval > 30} onClick={() => void run(async () => { accept(await saveHomeCarousel(config)); setMessage("已保存，首页轮播设置已生效。"); })}>{busy ? "处理中…" : "保存设置"}</button>
          <span>{config.slides.filter(s => s.enabled).length} / {config.slides.length} 张展示{dirty ? " · 有未保存修改" : ""}</span>
        </div>
        <p className="carousel-help">支持 JPEG、PNG、WebP，每张最大 40 MB、8000 万像素。会自动生成适配手机和桌面的展示图。{dirty && "请先保存设置，再上传或删除图片。"}</p>
        <div className="carousel-admin-grid">{config.slides.map((slide, index) => <article key={slide.id}>
          <img src={slide.variants[0].src} alt={slide.alt || slide.name} loading="lazy" />
          <h2>{index + 1}. {slide.name}</h2>
          <label><input type="checkbox" checked={slide.enabled} disabled={busy} onChange={event => setConfig({ ...config, slides: config.slides.map(s => s.id === slide.id ? { ...s, enabled: event.target.checked } : s) })} /> 展示</label>
          <label>图片描述（选填）<input value={slide.alt} maxLength={300} disabled={busy} onChange={event => setConfig({ ...config, slides: config.slides.map(s => s.id === slide.id ? { ...s, alt: event.target.value } : s) })} /></label>
          <div className="carousel-row-actions"><button disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`上移第 ${index + 1} 张`}>↑ 上移</button><button disabled={busy || index === config.slides.length - 1} onClick={() => move(index, 1)} aria-label={`下移第 ${index + 1} 张`}>↓ 下移</button><button disabled={busy || dirty} onClick={() => { if (window.confirm(`删除“${slide.name}”？`)) void run(async () => { accept(await deleteHomeSlide(slide.id, config.revision)); setMessage("图片已删除"); }); }}>删除</button></div>
        </article>)}</div>
        {!config.slides.length && <p>尚未上传轮播图片。首页暂时展示默认图片。</p>}
      </>}
    </section>
  </main>;
}
