import { useEffect, useRef, useState } from "react";
import { highPriorityImage, responsiveImage } from "../lib/images";
import { carouselFrame, slideIndex } from "../lib/carousel-motion";
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
  const position = useRef(0);
  const cards = useRef(new Map<number, HTMLDivElement>());
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
  const current = slides[slideIndex(index, count)];
  const next = slides[slideIndex(index + 1, count)];
  useEffect(() => {
    if (count < 2 || hover || hidden || reduced || !loaded[current?.id] || !loaded[next?.id]) return;
    let frame = 0, last = 0;
    const render = (now: number) => {
      if (last) position.current += Math.min(now - last, 64) / ((config?.interval || 5) * 1000);
      last = now;
      cards.current.forEach((card, sequence) => {
        const value = carouselFrame(sequence, position.current);
        card.style.transform = value.transform;
        card.style.opacity = String(value.opacity);
        card.style.zIndex = String(value.zIndex);
      });
      const arrival = Math.floor(position.current);
      if (arrival !== index) setIndex(arrival);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [count, hover, hidden, reduced, loaded, current?.id, next?.id, config?.interval, index]);
  function move(step: number) {
    if (count > 1) { position.current = index + step; setIndex(index + step); }
  }
  function failed(id: string) {
    setConfig(value => value ? { ...value, slides: value.slides.filter(s => s.id !== id) } : value);
    position.current = 0; setIndex(0);
  }
  const still = count === 1 || reduced;
  const sequences = still ? [index] : Array.from({ length: 9 }, (_, offset) => index + offset - 1);
  return <div className="hero-carousel" role="region" aria-roledescription="carousel" aria-label={english ? "Homepage images" : "首页图片轮播"}
    onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    onTouchStart={e => { touch.current = e.touches[0].clientX; }}
    onTouchEnd={e => { if (touch.current !== null && Math.abs(e.changedTouches[0].clientX - touch.current) > 45) move(e.changedTouches[0].clientX < touch.current ? 1 : -1); touch.current = null; }}>
    {count ? <div className={`hero-carousel-track${still ? " is-still" : ""}`}>
      {sequences.map(sequence => {
        const i = slideIndex(sequence, count), slide = slides[i];
        const full = sequence <= index + 1;
        return <div className="hero-carousel-slide" key={`${sequence}-${slide.id}`} ref={node => {
          if (node) cards.current.set(sequence, node); else cards.current.delete(sequence);
        }} aria-hidden={sequence !== index} style={still ? { transform: "none", opacity: 1 } : carouselFrame(sequence, position.current)}>
          <img {...(full ? source(slide) : { src: source(slide).src })} {...(sequence === index ? highPriorityImage : {})}
            alt={sequence === index ? slide.alt || (english ? `Selected photograph ${i + 1}` : `精选影像 ${i + 1}`) : ""}
            decoding="async" onLoad={() => { if (full) setLoaded(value => value[slide.id] ? value : { ...value, [slide.id]: true }); }} onError={() => failed(slide.id)} />
        </div>;
      })}
    </div> : <img {...responsiveImage("/images/automotive/hero-mclaren.jpg", [480, 960, 1600], "100vw")} {...highPriorityImage} alt={english ? "Red supercar in motion" : "行驶中的红色超级跑车"} loading="eager" decoding="async" />}
  </div>;
}
