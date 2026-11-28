import { ProjectCard } from "../components/ProjectCard";
import { Reveal } from "../components/Reveal";
import { categoryLabels, categoryLabelsEn, selectableCategories, type ProjectCategory } from "../data";
import { isEnglishLocation } from "../lib/language";
import { useProjects } from "../ProjectsContext";
import { useLocation } from "../router";

type Filter = ProjectCategory;

const filters: { value: Filter; label: string }[] = [
  ...selectableCategories.map(value => ({ value, label: categoryLabels[value] })),
];

export function WorksPage() {
  const english = isEnglishLocation(useLocation());
  const { projects } = useProjects();
  const { search, hash = "", navigate } = useLocation();
  const category = new URLSearchParams(search).get("category");
  const filter: Filter = filters.find((item) => item.value === category)?.value ?? selectableCategories[0];
  const visibleProjects = projects.filter((project) => project.category === filter).sort((a, b) => (b.shotAt ?? 0) - (a.shotAt ?? 0));

  function setFilter(value: Filter) {
    const params = new URLSearchParams(search);
    params.set("category", value);
    const query = params.toString();
    navigate(`/works${query ? `?${query}` : ""}${hash}`);
  }

  return (
    <main className="page-main">
      <section className="page-intro works-intro">
        <span>Selected archive · 2025—2026</span>
        <h1>{!english && <>作品<br /></>}WORK</h1>
        <p>{english ? "From commercial photography to digital imagery, every project starts with a brand challenge and responds with a clear, complete visual language." : "从商业摄影到数字影像，每个项目都从品牌问题出发，以清晰、完整的视觉语言回应。"}</p>
      </section>

      <section className="works-browser">
        <div className="filter-tabs" role="tablist" aria-label={english ? "Work categories" : "作品分类"}>
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {english ? categoryLabelsEn[item.value] : item.label}
              <span>
                {projects.filter((project) => project.category === item.value).length}
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
