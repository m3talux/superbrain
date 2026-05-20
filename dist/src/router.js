export function slug(s) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}
function withLinks(body, links) {
    const wl = links.filter(Boolean).map((l) => `[[${l}]]`);
    return wl.length ? `${body}\n\nRelated: ${wl.join(" ")}` : body;
}
// Helper: emit "## Heading\n\ncontent" only when content is non-empty. Lets the
// router omit sections the distiller chose not to fill.
function section(heading, content) {
    const v = (content || "").trim();
    return v ? `## ${heading}\n\n${v}` : "";
}
function joinSections(parts) {
    return parts.filter(Boolean).join("\n\n");
}
export function route(item) {
    const base = { created: item.date, updated: item.date, superbrain: true };
    switch (item.kind) {
        case "decision": {
            const structured = joinSections([
                section("Context", item.context),
                section("Decision", item.decision),
                section("Rationale", item.rationale),
                section("Consequences", item.consequences),
                section("Implementation", item.implementation),
            ]);
            const inner = structured || (item.body || "").trim();
            return {
                relPath: `decisions/${item.date}-${slug(item.title)}.md`,
                frontmatter: { type: "decision", status: "active", ...(item.project ? { project: slug(item.project) } : {}), ...base },
                body: withLinks(`# ${item.date} — ${item.title}\n\n${inner}`, item.links),
                mode: "create",
            };
        }
        case "project_fact":
            return {
                relPath: `projects/${slug(item.project || "unknown")}.md`,
                frontmatter: { type: "project", status: "active", project: slug(item.project || "unknown"), ...base },
                body: withLinks(`**${item.title}** — ${(item.body || "").trim()}`, item.links),
                mode: "append",
            };
        case "person":
            return {
                relPath: `people/${slug(item.person || "unknown")}.md`,
                frontmatter: { type: "person", status: "active", ...base },
                body: withLinks((item.body || "").trim(), item.links),
                mode: "append",
            };
        case "gotcha": {
            const structured = joinSections([
                section("Symptom", item.symptom),
                section("Root cause", item.rootCause),
                section("Fix", item.fix),
                section("Prevention", item.prevention),
            ]);
            const inner = structured || (item.body || "").trim();
            return {
                relPath: `projects/${slug(item.project || "unknown")}.md`,
                frontmatter: { type: "project", status: "active", project: slug(item.project || "unknown"), ...base },
                body: withLinks(`## Gotcha — ${item.title}\n\n${inner}`, item.links),
                mode: "append",
            };
        }
        case "lesson": {
            // "Structured" means the distiller filled one of the NEW lesson sections
            // (why / whenApplies). The legacy shape is { body, rule } — that path
            // must keep producing `**Why:** body` + `**Rule:** rule` for back-compat
            // with existing fixtures and any in-flight ndjson stubs.
            const hasStructured = !!((item.why || "").trim() || (item.whenApplies || "").trim());
            let inner;
            if (hasStructured) {
                inner = joinSections([
                    section("Rule", item.rule),
                    section("Why", item.why),
                    section("When this applies", item.whenApplies),
                ]);
            }
            else {
                const why = item.body ? `**Why:** ${item.body.trim()}` : "";
                const ruleLine = item.rule ? `\n\n**Rule:** ${item.rule}` : "";
                inner = `${why}${ruleLine}`.trim();
            }
            return {
                relPath: `lessons/${item.date}-${slug(item.title)}.md`,
                frontmatter: { type: "lesson", status: "active", ...base },
                body: withLinks(`# ${item.title}\n\n${inner}`, item.links),
                mode: "create",
            };
        }
        case "preference":
            return {
                relPath: `meta/preferences.md`,
                frontmatter: { type: "preference", ...base },
                body: (item.body || "").trim(),
                mode: "replace",
            };
        default:
            return {
                relPath: `capture/${item.date}-${slug(item.title)}.md`,
                frontmatter: { type: "capture", status: "active", tags: ["triage"], ...base },
                body: withLinks(`# ${item.title}\n\n${(item.body || "").trim()}`, item.links),
                mode: "create",
            };
    }
}
