import { useEffect, useRef, useState } from "react";
import { highPriorityImage, responsiveImage } from "../lib/images";
import { apertureOpen, carouselFrame, slideIndex } from "../lib/carousel-motion";
import type { HomeCarouselConfig, HomeSlide } from "../lib/projects";

function source(slide: HomeSlide) {
  const prefix = typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname) ? "https://img.twoquarters.com.cn" : "";
  return { src: prefix + slide.variants[0].src, srcSet: slide.variants.map(v => `${prefix}${v.src} ${v.width}w`).join(", "), sizes: "100vw" };
}

export function HomeCarousel({ english = false }: { english?: boolean }) {
  const [config, setConfig] = useState<HomeCarouselConfig | null>(null);
  const index = 0;
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);

  const track = useRef<HTMLDivElement>(null);
  const aperture = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (count < 2 || hidden || reduced) return;
    let frame = 0, last = 0;
    const render = (now: number) => {
      if (last) position.current += Math.min(now - last, 64);
      last = now;
      const stage = track.current, opening = aperture.current;
      if (stage && opening) {
        // Match the reference speed at the minimum (3s) setting; larger settings slow playback.
        const elapsed = position.current * 3 / (config?.interval || 3);
        opening.style.transform = `translate(-50%,-50%) scaleX(${apertureOpen(elapsed)})`;
        const baseWidth = cards.current.get(0)?.offsetWidth || 180;
        cards.current.forEach((card, sequence) => {
          const value = carouselFrame(Math.floor(sequence / 2), sequence % 2, elapsed, stage.clientWidth, window.innerHeight, baseWidth, opening.offsetHeight);
          Object.assign(card.style, { transform: value.transform, opacity: String(value.opacity), zIndex: String(value.zIndex) });
        });
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [count, hidden, reduced, config?.interval]);
  function failed(id: string) {
    setConfig(value => value ? { ...value, slides: value.slides.filter(s => s.id !== id) } : value);
    position.current = 0;
  }
  const still = count === 1 || reduced;
  const sequences = still ? [index] : Array.from({ length: 64 }, (_, offset) => offset);
  return <div className="hero-carousel" role="region" aria-roledescription="carousel" aria-label={english ? "Homepage images" : "首页图片轮播"}>
    {count ? <div ref={track} className={`hero-carousel-track${still ? " is-still" : ""}`}>
      {!still && <div ref={aperture} className="hero-carousel-aperture" aria-hidden="true" />}
      {sequences.map(sequence => {
        const i = slideIndex(sequence, count), slide = slides[i];

        return <div className="hero-carousel-slide" key={`${sequence}-${slide.id}`} ref={node => {
          if (node) cards.current.set(sequence, node); else cards.current.delete(sequence);
        }} aria-hidden={sequence !== index} style={still ? { transform: "none", opacity: 1 } : { opacity: 0, transformOrigin: sequence % 2 === 0 ? "100% 50%" : "0% 50%" }}>
          <img {...source(slide)} {...(sequence === index ? highPriorityImage : {})}
            alt={sequence === index ? slide.alt || (english ? `Selected photograph ${i + 1}` : `精选影像 ${i + 1}`) : ""}
            decoding="async" onError={() => failed(slide.id)} />
        </div>;
      })}
    </div> : <img {...responsiveImage("/images/automotive/hero-mclaren.jpg", [480, 960, 1600], "100vw")} {...highPriorityImage} alt={english ? "Red supercar in motion" : "行驶中的红色超级跑车"} loading="eager" decoding="async" />}
  </div>;
}
