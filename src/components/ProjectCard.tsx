import { ArrowUpRight } from "lucide-react";
import { categoryLabels, type Project } from "../data";
import { projectCardSizes, responsiveImage } from "../lib/images";
import { Link } from "../router";

export function ProjectCard({ project, index = 0, loading = index > 1 ? "lazy" : "eager" }: {
  project: Project;
  index?: number;
  loading?: "lazy" | "eager";
}) {
  return (
    <article className={`project-card project-card-${(index % 4) + 1}`}>
      <Link to={`/works/${project.slug}`}>
        <figure>
          <img {...responsiveImage(project.cover.src, [480, 960], projectCardSizes(index), project.cover.width)} alt={project.cover.alt} loading={loading} decoding="async" />
          <span className="project-open" aria-hidden="true"><ArrowUpRight /></span>
        </figure>
        <div className="project-card-meta">
          <div>
            <h3>{project.title}</h3>
            <p>{project.titleEn}</p>
          </div>
          <div>
            <span>{categoryLabels[project.category]}</span>
            <span>{project.year}</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
