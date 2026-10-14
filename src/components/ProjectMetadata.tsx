import type { Project } from "../data";
import { useLocation } from "../router";
import { isEnglishLocation } from "../lib/language";

type CreditRow = [string, string | undefined];

function creditRows(value: string | undefined, fallback: string): CreditRow[] {
  return (value || "").split(/[\r\n；]+/).map((line): CreditRow => {
    const text = line.trim();
    const match = /^([^：:]+)[：:]\s*(.+)$/.exec(text);
    return match ? [match[1].trim(), match[2].trim()] : [fallback, text];
  }).filter(([, value]) => Boolean(value?.trim()));
}

function creditRole(label: string) {
  const key = label.replace(/\s+/g, "").toLowerCase();
  const aliases: Record<string, string> = {
    "品牌": "brand",
    "代理商": "agency",
    "制作公司": "productioncompany",
    "摄影师": "photographer",
    "摄影指导": "photographer",
    "后期团队": "retouchteam",
  };
  return aliases[key] || key;
}

export function ProjectMetadata({ project, includeCredits = false }: { project: Project; includeCredits?: boolean }) {
  const english = isEnglishLocation(useLocation());
  let rows: CreditRow[] = [
    [english ? "Brand" : "品牌", project.brand],
    [english ? "Agency" : "代理商", project.agency],
    [english ? "Production Company" : "制作公司", "Twoquarters"],
    [english ? "Photographer" : "摄影师", project.photographer],
    [english ? "Retouch Team" : "后期团队", project.retouchTeam],
  ];

  if (includeCredits) {
    const credits = creditRows(project.credits, english ? "Credit" : "项目署名");
    const post = creditRows(project.retouchTeam, english ? "Retouch Team" : "后期团队");
    const photographerInCredits = credits.some(([label, value]) =>
      creditRole(label) === "photographer" && value?.trim() === project.photographer?.trim());
    rows = [
      ...rows.slice(0, 3),
      ...(photographerInCredits ? [] : [rows[3]]),
      ...credits,
      ...post,
    ];
    const seen = new Set<string>();
    rows = rows.filter(([label, value]) => {
      if (!value?.trim()) return false;
      const key = `${creditRole(label)}:${value.trim().replace(/\s+/g, " ").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return (
    <section className="project-metadata" aria-label={english ? "Project credits" : "项目制作信息"}>
      <dl>
        {rows.filter(([, value]) => value?.trim()).map(([label, value]) => (
          <div key={`${label}:${value}`}>
            <dt>{label}{english ? ":" : "："}</dt>
            <dd>{value?.trim()}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
