import { ArrowUpRight } from "lucide-react";
import { categoryLabels, type Project } from "../data";
import { Link } from "../router";

export function ProjectCard({ project, index = 0 }: { project: Project; index?: number }) {
  return (
    <article className={`project-card project-card-${(index % 4) + 1}`}>
      <Link to={`/works/${project.slug}`}>
        <figure>
          <img src={project.cover.src} alt={project.cover.alt} loading={index > 1 ? "lazy" : "eager"} />
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
