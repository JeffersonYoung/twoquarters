import { useState } from "react";
import { ProjectCard } from "../components/ProjectCard";
import { Reveal } from "../components/Reveal";
import { categoryLabels, selectableCategories, type ProjectCategory } from "../data";
import { useProjects } from "../ProjectsContext";

type Filter = "all" | ProjectCategory;

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "全部" },
  ...selectableCategories.map(value => ({ value, label: categoryLabels[value] })),
];

export function WorksPage() {
  const { projects } = useProjects();
  const [filter, setFilter] = useState<Filter>("all");
  const visibleProjects = filter === "all" ? projects : projects.filter((project) => project.category === filter);

  return (
    <main className="page-main">
      <section className="page-intro works-intro">
        <span>Selected archive · 2025—2026</span>
        <h1>作品<br />WORK</h1>
        <p>从商业摄影到数字影像，每个项目都从品牌问题出发，以清晰、完整的视觉语言回应。</p>
      </section>

      <section className="works-browser">
        <div className="filter-tabs" role="tablist" aria-label="作品分类">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
              <span>
                {item.value === "all" ? projects.length : projects.filter((project) => project.category === item.value).length}
              </span>
            </button>
          ))}
        </div>

        <div className="works-grid" key={filter}>
          {visibleProjects.map((project, index) => (
            <Reveal key={project.slug} delay={(index % 2) * 70}>
              <ProjectCard project={project} index={index} />
            </Reveal>
          ))}
        </div>
      </section>
    </main>
  );
}
