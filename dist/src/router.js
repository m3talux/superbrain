export function slug(s) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}
function withLinks(body, links) {
    const wl = links.filter(Boolean).map((l) => `[[${l}]]`);
    return wl.length ? `${body}\n\nRelated: ${wl.join(" ")}` : body;
}
export function route(item) {
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
        case "lesson": {
            const why = `**Why:** ${item.body}`;
            const ruleLine = item.rule ? `\n\n**Rule:** ${item.rule}` : "";
            return { relPath: `lessons/${item.date}-${slug(item.title)}.md`,
                frontmatter: { type: "lesson", status: "active", ...base },
                body: withLinks(`# ${item.title}\n\n${why}${ruleLine}`, item.links), mode: "create" };
        }
        case "preference":
            return { relPath: `meta/preferences.md`,
                frontmatter: { type: "preference", ...base },
                body: item.body, mode: "replace" };
        default:
            return { relPath: `capture/${item.date}-${slug(item.title)}.md`,
                frontmatter: { type: "capture", status: "active", tags: ["triage"], ...base },
                body: withLinks(`# ${item.title}\n\n${item.body}`, item.links), mode: "create" };
    }
}
