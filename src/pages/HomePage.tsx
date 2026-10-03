import { ArrowDown, ArrowRight } from "lucide-react";
import { ProjectCard } from "../components/ProjectCard";
import { Reveal } from "../components/Reveal";
import { highPriorityImage, responsiveImage } from "../lib/images";
import { useProjects } from "../ProjectsContext";
import { Link } from "../router";

const capabilities = [
  ["01", "Photography", "商业摄影", "从人物、汽车到静物，用完整的前期与现场制作建立统一视觉。"],
  ["02", "CGI", "数字影像", "将实拍质感、三维资产和后期工艺组合成可持续扩展的品牌图像。"],
  ["03", "Production", "整合制作", "连接欧洲与亚洲的创意及制作资源，把复杂项目转化为清晰流程。"],
];

export function HomePage({ english = false }: { english?: boolean }) {
  const { projects } = useProjects();
  const featured = projects.slice(0, 4);

  return (
    <main>
      <section className="home-hero">
        <img {...responsiveImage("/images/automotive/hero-mclaren.jpg", [480, 960, 1600], "100vw")} {...highPriorityImage} alt={english ? "Red supercar in motion" : "行驶中的红色超级跑车"} loading="eager" decoding="async" />
        <div className="hero-shade" />
        <div className="hero-topline">
          <span>{english ? "Independent image production" : "独立影像制作机构"}</span>
          <span>HK · DE · CN</span>
        </div>
        <div className="hero-title">
          <p>{english ? "Photography / CGI / Production" : "摄影 / CGI / 整合制作"}</p>
          <h1>TWO<br />QUARTERS</h1>
        </div>
        <a className="hero-scroll" href="#work" aria-label={english ? "View selected work" : "查看精选作品"}>
          <span>{english ? "Selected work" : "精选作品"}</span>
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
          <h2>{english ? "Selected work" : "精选作品"}</h2>
          {!english && <Link to="/works">查看全部 <ArrowRight aria-hidden="true" /></Link>}
        </div>
        <div className="home-projects">
          {featured.map((project, index) => (
            <Reveal key={project.slug} delay={(index % 2) * 80}>
              <ProjectCard project={project} index={index} loading="lazy" />
            </Reveal>
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
          {capabilities.map(([number, en, zh, description]) => (
            <Reveal key={number}>
              <article>
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
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="studio-note">
        <div className="section-index">03 / 04</div>
        <Reveal className="studio-copy">
          <span>{english ? "Since 1998" : "始于 1998"}</span>
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
