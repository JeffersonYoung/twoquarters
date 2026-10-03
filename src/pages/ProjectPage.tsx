import { ArrowLeft, ArrowRight, Maximize2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Lightbox } from "../components/Lightbox";
import { ProjectWatch } from "../components/ProjectWatch";
import { playableVideos } from "../lib/videos";
import { Reveal } from "../components/Reveal";
import { categoryLabels } from "../data";
import { highPriorityImage, projectGallerySizes, responsiveImage } from "../lib/images";
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
  const videos = playableVideos(project);
  const isVideoProject = project.category === "video" || videos.length > 0;
  const previous = projects[(projectIndex - 1 + projects.length) % projects.length];
  const next = projects[(projectIndex + 1) % projects.length];

  return (
    <main className={`project-page${isVideoProject ? " project-watch-page" : ""}`}>
      {isVideoProject ? <ProjectWatch project={project} videos={videos} /> : <section className="project-hero">
        <img {...responsiveImage(project.cover.src, [960, 1600], "100vw", project.cover.width)} {...highPriorityImage} alt={project.cover.alt} width={project.cover.width} height={project.cover.height} loading="eager" decoding="async" />
        <div className="project-hero-overlay" />
        <Link className="project-back" to="/works"><ArrowLeft aria-hidden="true" /> 所有作品</Link>
        <div className="project-hero-title">
          <span>{String(projectIndex + 1).padStart(2, "0")} / {String(projects.length).padStart(2, "0")}</span>
          <h1>{project.title}</h1>
          <p>{project.titleEn}</p>
        </div>
      </section>}

      <section className="project-information">
        <div className="project-facts">
          <div><span>年份</span><strong>{project.year}</strong></div>
          <div><span>类别</span><strong>{categoryLabels[project.category]}</strong></div>
          <div><span>服务</span><strong>{project.discipline}</strong></div>
        </div>
        {isVideoProject ? <p className="project-summary">{project.summary}</p> : <Reveal>
          <p className="project-summary">{project.summary}</p>
        </Reveal>}
      </section>

      {isVideoProject && project.credits && <section className="project-credit"><span>Credits</span><p>{project.credits}</p></section>}

      {!isVideoProject && <section className={`project-gallery gallery-${project.category}`}>
        {project.images.map((image, index) => (
          <Reveal key={image.src} className={`gallery-shot gallery-shot-${(index % 5) + 1}`}>
            <button type="button" onClick={() => setLightboxIndex(index)} aria-label={`查看大图：${image.alt}`}>
              <img {...responsiveImage(image.src, [960, 1600], projectGallerySizes(index), image.width)} alt={image.alt} width={image.width} height={image.height} loading="lazy" decoding="async" />
              <span className="shot-expand"><Maximize2 aria-hidden="true" /></span>
            </button>
            {image.credit && <p>{image.credit}</p>}
          </Reveal>
        ))}
      </section>}

      {!isVideoProject && <section className="project-credit">
        <span>Credits</span>
        <p>{project.credits}</p>
      </section>}

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

      {!isVideoProject && lightboxIndex !== null && (
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
