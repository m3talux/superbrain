export type Kind = "decision" | "project_fact" | "person" | "gotcha" | "capture";
export interface DistilledItem {
  kind: Kind;
  title: string;
  body: string;
  date: string;            // YYYY-MM-DD
  links: string[];
  project?: string;
  person?: string;
}
export interface RouteResult {
  relPath: string;
  frontmatter: Record<string, any>;
  body: string;
  mode: "create" | "append";
}

export function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}
function withLinks(body: string, links: string[]): string {
  const wl = links.filter(Boolean).map((l) => `[[${l}]]`);
  return wl.length ? `${body}\n\nRelated: ${wl.join(" ")}` : body;
}

export function route(item: DistilledItem): RouteResult {
  const base = { created: item.date, updated: item.date, superbrain: true };
  switch (item.kind) {
    case "decision":
      return { relPath: `decisions/${item.date}-${slug(item.title)}.md`,
        frontmatter: { type: "decision", status: "active", ...base },
        body: withLinks(`# ${item.date} — ${item.title}\n\n${item.body}`, item.links), mode: "create" };
    case "project_fact":
      return { relPath: `projects/${slug(item.project || "unknown")}.md`,
        frontmatter: { type: "project", status: "active", project: slug(item.project || "unknown"), ...base },
        body: withLinks(`**${item.title}** — ${item.body}`, item.links), mode: "append" };
    case "person":
      return { relPath: `people/${slug(item.person || "unknown")}.md`,
        frontmatter: { type: "person", status: "active", ...base },
        body: withLinks(item.body, item.links), mode: "append" };
    case "gotcha":
      return { relPath: `projects/${slug(item.project || "unknown")}.md`,
        frontmatter: { type: "project", status: "active", project: slug(item.project || "unknown"), ...base },
        body: withLinks(`## Gotchas\n\n- ${item.title}: ${item.body}`, item.links), mode: "append" };
    default:
      return { relPath: `capture/${item.date}-${slug(item.title)}.md`,
        frontmatter: { type: "capture", status: "active", tags: ["triage"], ...base },
        body: withLinks(`# ${item.title}\n\n${item.body}`, item.links), mode: "create" };
  }
}
