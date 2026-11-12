import { useEffect, useRef, useState } from "react";
import { highPriorityImage, responsiveImage } from "../lib/images";
import type { HomeCarouselConfig, HomeSlide } from "../lib/projects";

function source(slide: HomeSlide) {
  const prefix = typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname) ? "https://img.twoquarters.com.cn" : "";
  return { src: prefix + slide.variants[0].src, srcSet: slide.variants.map(v => `${prefix}${v.src} ${v.width}w`).join(", "), sizes: "100vw" };
}

export function HomeCarousel({ english = false }: { english?: boolean }) {
  const [config, setConfig] = useState<HomeCarouselConfig | null>(null);
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const touch = useRef<number | null>(null);
  const previousIndex = useRef(0);
  const wrapping = Math.abs(index - previousIndex.current) > 1;
  useEffect(() => { previousIndex.current = index; }, [index]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/home-carousel", { signal: controller.signal, cache: "no-store" }).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(value => {
      if (Array.isArray(value.slides)) setConfig(value);
    }).catch(() => { /* Existing hero remains available on a failed configuration request. */ });
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    motion(); visibility(); media.addEventListener("change", motion); document.addEventListener("visibilitychange", visibility);
    return () => { controller.abort(); media.removeEventListener("change", motion); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const slides = config?.slides || [], count = slides.length;
  const current = slides[index];
  useEffect(() => {
    if (count < 2 || hover || hidden || reduced || !loaded[current?.id]) return;
    const timer = window.setTimeout(() => setIndex(i => (i + 1) % count), (config?.interval || 5) * 1000);
    return () => window.clearTimeout(timer);
  }, [count, hover, hidden, reduced, loaded, current?.id, config?.interval, index]);
  function move(step: number) { if (count > 1) { setIndex(i => (i + step + count) % count); } }
  return <div className="hero-carousel" role="region" aria-roledescription="carousel" aria-label={english ? "Homepage images" : "首页图片轮播"}
    onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    onTouchStart={e => { touch.current = e.touches[0].clientX; }}
    onTouchEnd={e => { if (touch.current !== null && Math.abs(e.changedTouches[0].clientX - touch.current) > 45) move(e.changedTouches[0].clientX < touch.current ? 1 : -1); touch.current = null; }}>
    {count ? <div className="hero-carousel-track" style={{ transform: `translateX(-${index * 100}%)`, transition: wrapping ? "none" : undefined }}>
      {slides.map((slide, i) => <div className="hero-carousel-slide" key={slide.id} aria-hidden={i !== index}>
        {(i === index || i === (index + 1) % count || i === (index + count - 1) % count) && <img {...source(slide)} {...(i === index ? highPriorityImage : {})} alt={slide.alt || (english ? `Selected photograph ${i + 1}` : `精选影像 ${i + 1}`)} loading={i === index ? "eager" : "lazy"} decoding="async" onLoad={() => setLoaded(value => ({ ...value, [slide.id]: true }))} onError={() => { setConfig(value => value ? { ...value, slides: value.slides.filter(s => s.id !== slide.id) } : value); setIndex(0); }} />}
      </div>)}
    </div> : <img {...responsiveImage("/images/automotive/hero-mclaren.jpg", [480, 960, 1600], "100vw")} {...highPriorityImage} alt={english ? "Red supercar in motion" : "行驶中的红色超级跑车"} loading="eager" decoding="async" />}
  </div>;
}
