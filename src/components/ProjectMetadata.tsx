import type { Project } from "../data";

export function ProjectMetadata({ project }: { project: Project }) {
  const rows = [
    ["Brand", project.brand],
    ["Agency", project.agency],
    ["Production Company", "Twoquarters"],
    ["Photographer", project.photographer],
    ["Retouch Team", project.retouchTeam],
  ];

  return (
    <section className="project-metadata" aria-label="项目制作信息">
      <dl>
        {rows.filter(([, value]) => value?.trim()).map(([label, value]) => (
          <div key={label}>
            <dt>{label}:</dt>
            <dd>{value?.trim()}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
