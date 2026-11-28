import { ArrowDown, ArrowRight } from "lucide-react";
import { categoryLabels, categoryLabelsEn, selectableCategories } from "../data";
import { originalImageSource } from "../lib/images";
import { useEffect, useState } from "react";
import type { HomeCategoryConfig } from "../lib/projects";
import { Reveal } from "../components/Reveal";
import { HomeCarousel } from "../components/HomeCarousel";
import { localizedHref } from "../lib/language";
import { useProjects } from "../ProjectsContext";
import { Link } from "../router";

const capabilities = [
  ["01", "Photography", "商业摄影", "从人物、汽车到静物，用完整的前期与现场制作建立统一视觉。", "/works?category=automotive"],
  ["02", "CGI", "数字影像", "将实拍质感、三维资产和后期工艺组合成可持续扩展的品牌图像。", "/works?category=cg-ai"],
  ["03", "Production", "整合制作", "连接欧洲与亚洲的创意及制作资源，把复杂项目转化为清晰流程。", "/works?category=bts"],
];

export function HomePage({ english = false }: { english?: boolean }) {
  const { projects } = useProjects();
  const [covers, setCovers] = useState<HomeCategoryConfig["covers"]>({});
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/home-categories", { signal: controller.signal, cache: "no-store" })
      .then(response => { if (!response.ok) throw Error("Category covers unavailable"); return response.json(); })
      .then((value: HomeCategoryConfig) => setCovers(value.covers)).catch(() => {});
    return () => controller.abort();
  }, []);
  const workLabel = english ? "Work categories" : "作品栏目";
  const categories = selectableCategories.map(category => {
    const items = projects.filter(project => project.category === category);
    const cover = covers[category];
    return { category, count: items.length, cover };
  });

  return (
    <main>
      <section className="home-hero">
        <HomeCarousel english={english} />
        <div className="hero-shade" />
        <div className="hero-topline">
          <span>{english ? "Independent image production" : "独立影像制作机构"}</span>
          <span>HK · DE · CN</span>
        </div>
        <div className="hero-title">
          <h1>TWO<br />QUARTERS</h1>
        </div>
        <a className="hero-scroll" href="#work">
          <span>{workLabel}</span>
          <ArrowDown aria-hidden="true" />
        </a>
      </section>

      <section className="intro-band">
        <div className="section-index">00 / 04</div>
        <Reveal>
          <p className="intro-statement">
            {english
              ? "We build images that move between the physical and the imagined."
              : "我们在真实与想象之间，构建有力量的品牌影像。"}
          </p>
        </Reveal>
        <p className="intro-aside">
          {english
            ? "Twoquarters is an independent photography and CGI studio working across Europe and Asia."
            : "Twoquarters 是一家横跨欧洲与亚洲的独立摄影与 CGI 创意制作机构。"}
        </p>
      </section>

      <section className="selected-work" id="work">
        <div className="section-heading">
          <span>01</span>
          <h2>{workLabel}</h2>

        </div>
        <div className="home-category-index">
          {categories.map(({ category, count, cover }) => (
            <Link key={category} className={`home-category-card${category === "automotive" ? " home-category-card--automotive" : ""}`} to={localizedHref(`/works?category=${category}`, english)}>
              {cover && <img src={originalImageSource(cover.variants[0].src)} srcSet={cover.variants.map(v => `${originalImageSource(v.src)} ${v.width}w`).join(", ")} sizes={category === "automotive" ? "(max-width: 640px) 100vw, 50vw" : "(max-width: 640px) 50vw, 25vw"} alt="" loading="lazy" decoding="async" onError={event => { const image = event.currentTarget; if (image.dataset.fallback) return; image.dataset.fallback = "true"; image.srcset = cover.variants.map(v => `${v.src} ${v.width}w`).join(", "); image.src = cover.variants[0].src; }} />}
              <div className="home-category-label">
                <h3>{english ? categoryLabelsEn[category] : categoryLabels[category]}</h3>
                <p>{count} {english ? (count === 1 ? "project" : "projects") : "个项目"}</p>
              </div>
            </Link>
          ))}
        </div>
        {english && (
          <a className="text-link" href="#capabilities">
            View capabilities <ArrowDown aria-hidden="true" />
          </a>
        )}
      </section>

      <section className="capabilities" id="capabilities">
        <div className="section-heading section-heading-light">
          <span>02</span>
          <h2>{english ? "Capabilities" : "核心能力"}</h2>
        </div>
        <div className="capability-list">
          {capabilities.map(([number, en, zh, description, href]) => (
            <Reveal key={number}>
              <Link to={href} className="capability-link" aria-label={english ? `${en}: View work` : `${zh}：查看作品`}>
                <span>{number}</span>
                <h3>{english ? en : zh}</h3>
                <p>
                  {english
                    ? {
                        "Photography": "Commercial photography shaped by a single visual language, from people and automobiles to still life.",
                        "CGI": "Photographic craft and digital image-making combined into scalable brand worlds.",
                        "Production": "Creative and production resources across Europe and Asia, connected through one clear process.",
                      }[en]
                    : description}
                </p>
                <ArrowRight aria-hidden="true" />
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="studio-note">
        <div className="section-index">03 / 04</div>
        <Reveal className="studio-copy">
          <span>{english ? "Since 2011" : "始于 2011"}</span>
          <h2>{english ? "A global perspective, made precise." : "国际视野，落地为精确执行。"}</h2>
          <p>
            {english
              ? "Our photographers, artists and production teams turn ambitious ideas into images that feel immediate, exact and alive."
              : "摄影师、数字艺术家与制作团队共同工作，让大胆创意最终成为直接、精确且充满生命力的图像。"}
          </p>
          {!english && <Link className="underline-link" to="/about">了解 Twoquarters <ArrowRight aria-hidden="true" /></Link>}
        </Reveal>
      </section>
    </main>
  );
}
