import type { Project } from "../data";
import { useLocation } from "../router";
import { isEnglishLocation } from "../lib/language";

export function ProjectMetadata({ project }: { project: Project }) {
  const english = isEnglishLocation(useLocation());
  const rows = [
    [english ? "Brand" : "品牌", project.brand],
    [english ? "Agency" : "代理商", project.agency],
    [english ? "Production Company" : "制作公司", "Twoquarters"],
    [english ? "Photographer" : "摄影师", project.photographer],
    [english ? "Retouch Team" : "后期团队", project.retouchTeam],
  ];

  return (
    <section className="project-metadata" aria-label={english ? "Project credits" : "项目制作信息"}>
      <dl>
        {rows.filter(([, value]) => value?.trim()).map(([label, value]) => (
          <div key={label}>
            <dt>{label}{english ? ":" : "："}</dt>
            <dd>{value?.trim()}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
