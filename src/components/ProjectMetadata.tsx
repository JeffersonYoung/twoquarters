import type { Project } from "../data";
import { useLocation } from "../router";
import { isEnglishLocation } from "../lib/language";

type CreditRow = [string, string | undefined];

const englishCreditLabels: Record<string, string> = {
  "品牌": "Brand", "代理商": "Agency", "制作公司": "Production Company",
  "摄影师": "Photographer", "摄影指导": "Director of Photography", "后期团队": "Post-production",
  "客户": "Client", "Creative创意": "Creative", "监制": "Executive Producer",
  "制片": "Producer", "总导演": "Director", "导演": "Director", "摄影大助": "First Camera Assistant",
  "航拍": "Aerial Cinematography", "造型": "Styling", "女模": "Female Model",
  "男模": "Male Model", "童模": "Child Model", "调色": "Color Grading",
  "剪辑": "Editing", "声音设计/混音": "Sound Design / Mixing",
};

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
            <dt>{english ? englishCreditLabels[label] || label : label}{english ? ":" : "："}</dt>
            <dd>{value?.trim()}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
