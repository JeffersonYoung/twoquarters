import { ArrowLeft, ArrowRight, Maximize2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Lightbox } from "../components/Lightbox";
import { Reveal } from "../components/Reveal";
import { categoryLabels } from "../data";
import { useProjects } from "../ProjectsContext";
import { Link, Navigate, useParams } from "../router";

export function ProjectPage() {
  const { projects, loading } = useProjects();
  const { slug } = useParams();
  const projectIndex = projects.findIndex((item) => item.slug === slug);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const changeLightbox = useCallback((index: number) => setLightboxIndex(index), []);

  if (loading) return <main className="project-loading">正在加载项目</main>;
  if (projectIndex < 0) return <Navigate to="/works" replace />;

  const project = projects[projectIndex];
  const previous = projects[(projectIndex - 1 + projects.length) % projects.length];
  const next = projects[(projectIndex + 1) % projects.length];

  return (
    <main className="project-page">
      <section className="project-hero">
        <img src={project.cover.src} alt={project.cover.alt} />
        <div className="project-hero-overlay" />
        <Link className="project-back" to="/works"><ArrowLeft aria-hidden="true" /> 所有作品</Link>
        <div className="project-hero-title">
          <span>{String(projectIndex + 1).padStart(2, "0")} / {String(projects.length).padStart(2, "0")}</span>
          <h1>{project.title}</h1>
          <p>{project.titleEn}</p>
        </div>
      </section>

      <section className="project-information">
        <div className="project-facts">
          <div><span>年份</span><strong>{project.year}</strong></div>
          <div><span>类别</span><strong>{categoryLabels[project.category]}</strong></div>
          <div><span>服务</span><strong>{project.discipline}</strong></div>
        </div>
        <Reveal>
          <p className="project-summary">{project.summary}</p>
        </Reveal>
      </section>

      <section className={`project-gallery gallery-${project.category}`}>
        {project.images.map((image, index) => (
          <Reveal key={image.src} className={`gallery-shot gallery-shot-${(index % 5) + 1}`}>
            <button type="button" onClick={() => setLightboxIndex(index)} aria-label={`查看大图：${image.alt}`}>
              <img src={image.src} alt={image.alt} loading={index > 1 ? "lazy" : "eager"} />
              <span className="shot-expand"><Maximize2 aria-hidden="true" /></span>
            </button>
            {image.credit && <p>{image.credit}</p>}
          </Reveal>
        ))}
      </section>

      {project.videos?.some((video) => video.status === "ready") && (
        <section className="project-videos" aria-label="项目视频">
          {project.videos.filter((video) => video.status === "ready").map((video) => (
            <figure key={video.id}>
              <video src={video.src} controls playsInline preload="metadata" aria-label={video.name} />
              <figcaption>{video.name}</figcaption>
            </figure>
          ))}
        </section>
      )}

      <section className="project-credit">
        <span>Credits</span>
        <p>{project.credits}</p>
      </section>

      <nav className="project-pagination" aria-label="项目导航">
        <Link to={`/works/${previous.slug}`}>
          <ArrowLeft aria-hidden="true" />
          <span>上一个项目<strong>{previous.title}</strong></span>
        </Link>
        <Link to={`/works/${next.slug}`}>
          <span>下一个项目<strong>{next.title}</strong></span>
          <ArrowRight aria-hidden="true" />
        </Link>
      </nav>

      {lightboxIndex !== null && (
        <Lightbox
          images={project.images}
          index={lightboxIndex}
          onChange={changeLightbox}
          onClose={closeLightbox}
        />
      )}
    </main>
  );
}
