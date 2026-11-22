import { ArrowLeft, ArrowRight, Maximize2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Lightbox } from "../components/Lightbox";
import { ProjectWatch } from "../components/ProjectWatch";
import { ProjectMetadata } from "../components/ProjectMetadata";
import { playableVideos } from "../lib/videos";
import { Reveal } from "../components/Reveal";
import { highPriorityImage, originalImageSource, projectGallerySizes, responsiveImage } from "../lib/images";
import { useProjects } from "../ProjectsContext";
import { Link, Navigate, useParams, useLocation } from "../router";
import { isEnglishLocation, localizedHref } from "../lib/language";

export function ProjectPage() {
  const english = isEnglishLocation(useLocation());
  const { projects, loading } = useProjects();
  const { slug } = useParams();
  const projectIndex = projects.findIndex((item) => item.slug === slug);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const changeLightbox = useCallback((index: number) => setLightboxIndex(index), []);

  if (loading) return <main className="project-loading">{english ? "Loading project" : "正在加载项目"}</main>;
  if (projectIndex < 0) return <Navigate to={localizedHref("/works", english)} replace />;

  const project = projects[projectIndex];
  const isLongform = project.presentation === "longform";
  const longformImage = project.images.find(image => image.id === project.longformImageId);
  const videos = playableVideos(project);
  const isVideoProject = !isLongform && (project.category === "video" || videos.length > 0);
  const previous = projects[(projectIndex - 1 + projects.length) % projects.length];
  const next = projects[(projectIndex + 1) % projects.length];

  return (
    <main className={`project-page${isVideoProject ? " project-watch-page" : ""}${isLongform ? " project-longform-page" : ""}`}>
      {isLongform && longformImage && <section className="project-longform" aria-label={english ? "Complete photographic essay" : "完整长图作品"}>
        <img src={originalImageSource(longformImage.src)} onError={({ currentTarget }) => {
          if (currentTarget.getAttribute("src") !== longformImage.src) currentTarget.src = longformImage.src;
        }} alt={english ? project.titleEn || project.title : project.title} width={longformImage.width} height={longformImage.height} {...highPriorityImage} loading="eager" decoding="async" />
      </section>}
      {isLongform ? <header className="longform-heading">
        <Link to={localizedHref("/works", english)}><ArrowLeft aria-hidden="true" />{english ? "All work" : "所有作品"}</Link>
        <h1>{english ? project.titleEn || project.title : project.title}</h1>
      </header> : isVideoProject ? <ProjectWatch project={project} videos={videos} /> : <section className="project-hero">
        <img {...responsiveImage(project.cover.src, [960, 1600], "100vw", project.cover.width)} {...highPriorityImage} alt="" width={project.cover.width} height={project.cover.height} loading="eager" decoding="async" />
        <div className="project-hero-overlay" />
        <Link className="project-back" to="/works"><ArrowLeft aria-hidden="true" /> {english ? "All work" : "所有作品"}</Link>
        <div className="project-hero-title">
          <span>{String(projectIndex + 1).padStart(2, "0")} / {String(projects.length).padStart(2, "0")}</span>
          <h1>{english ? project.titleEn || project.title : project.title}</h1>
          {!english && <p>{project.titleEn}</p>}
        </div>
      </section>}

      <ProjectMetadata project={project} includeCredits={isVideoProject} />

      {project.summary && <section className="project-information">
        {isVideoProject ? <p className="project-summary">{project.summary}</p> : <Reveal>
          <p className="project-summary">{project.summary}</p>
        </Reveal>}
      </section>}

      



      {!isLongform && !isVideoProject && <section className={`project-gallery gallery-${project.category}`}>
        {project.images.map((image, index) => (
          <Reveal key={image.src} className={`gallery-shot gallery-shot-${(index % 5) + 1}`}>
            <button type="button" onClick={() => setLightboxIndex(index)} aria-label={english ? `View image ${index + 1}` : `查看第 ${index + 1} 张大图`}>
              <img {...responsiveImage(image.src, [960, 1600], projectGallerySizes(index), image.width)} alt="" width={image.width} height={image.height} loading="lazy" decoding="async" />
              <span className="shot-expand"><Maximize2 aria-hidden="true" /></span>
            </button>
          </Reveal>
        ))}
      </section>}

      {!isVideoProject && project.credits && <section className="project-credit">
        <span>Credits</span>
        <p>{project.credits}</p>
      </section>}

      <nav className="project-pagination" aria-label={english ? "Project navigation" : "项目导航"}>
        <Link to={`/works/${previous.slug}`}>
          <ArrowLeft aria-hidden="true" />
          <span>{english ? "Previous project" : "上一个项目"}<strong>{english ? previous.titleEn || previous.title : previous.title}</strong></span>
        </Link>
        <Link to={`/works/${next.slug}`}>
          <span>{english ? "Next project" : "下一个项目"}<strong>{english ? next.titleEn || next.title : next.title}</strong></span>
          <ArrowRight aria-hidden="true" />
        </Link>
      </nav>

      {!isLongform && !isVideoProject && lightboxIndex !== null && (
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
