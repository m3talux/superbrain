export function asText(v) {
    if (typeof v === "string")
        return v;
    if (v === null || v === undefined)
        return "";
    if (typeof v === "object") {
        try {
            return JSON.stringify(v);
        }
        catch {
            return String(v);
        }
    }
    return String(v);
}
export function slug(s) {
    return asText(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}
function withLinks(body, links) {
    const wl = links.filter(Boolean).map((l) => `[[${l}]]`);
    return wl.length ? `${body}\n\nRelated: ${wl.join(" ")}` : body;
}
function section(heading, content) {
    const v = asText(content).trim();
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
                section("Decision", item.decision),
                section("Why", item.why || item.rationale),
                section("Alternatives considered", item.alternatives),
                section("Consequences", item.consequences),
            ]);
            const inner = structured || asText(item.body).trim();
            return {
                relPath: `decisions/${item.date}-${slug(item.title)}.md`,
                frontmatter: { type: "decision", status: "active", ...(item.project ? { project: slug(item.project) } : {}), ...base },
                body: withLinks(`# ${item.date} — ${asText(item.title)}\n\n${inner}`, item.links),
                mode: "create",
            };
        }
        case "project_fact":
            return {
                relPath: `projects/${slug(item.project || "unknown")}.md`,
                frontmatter: { type: "project", status: "active", project: slug(item.project || "unknown"), ...base },
                body: withLinks(`**${asText(item.title)}** — ${asText(item.body).trim()}`, item.links),
                mode: "append",
            };
        case "person":
            return {
                relPath: `people/${slug(item.person || "unknown")}.md`,
                frontmatter: { type: "person", status: "active", ...base },
                body: withLinks(asText(item.body).trim(), item.links),
                mode: "append",
            };
        case "gotcha": {
            const structured = joinSections([
                section("Symptom", item.symptom),
                section("Root cause", item.rootCause),
                section("Fix", item.fix),
                section("Prevention", item.prevention),
            ]);
            const inner = structured || asText(item.body).trim();
            return {
                relPath: `projects/${slug(item.project || "unknown")}.md`,
                frontmatter: { type: "project", status: "active", project: slug(item.project || "unknown"), ...base },
                body: withLinks(`## Gotcha — ${asText(item.title)}\n\n${inner}`, item.links),
                mode: "append",
            };
        }
        case "lesson": {
            const hasStructured = !!(asText(item.why).trim() || asText(item.whenApplies).trim());
            let inner;
            if (hasStructured) {
                inner = joinSections([
                    section("Rule", item.rule),
                    section("Why", item.why),
                    section("When this applies", item.whenApplies),
                ]);
            }
            else {
                const whyBody = asText(item.body).trim();
                const why = whyBody ? `**Why:** ${whyBody}` : "";
                const ruleLine = item.rule ? `\n\n**Rule:** ${asText(item.rule).trim()}` : "";
                inner = `${why}${ruleLine}`.trim();
            }
            return {
                relPath: `lessons/${item.date}-${slug(item.title)}.md`,
                frontmatter: { type: "lesson", status: "active", ...base },
                body: withLinks(`# ${asText(item.title)}\n\n${inner}`, item.links),
                mode: "create",
            };
        }
        case "preference":
            return {
                relPath: `meta/preferences.md`,
                frontmatter: { type: "preference", ...base },
                body: asText(item.body).trim(),
                mode: "replace",
            };
        case "daily":
            return {
                relPath: `daily/${item.date}.md`,
                frontmatter: { type: "daily", ...base },
                body: withLinks(asText(item.body).trim(), item.links),
                mode: "append",
            };
        default: {
            const dailyTitle = asText(item.title).match(/^daily-(\d{4}-\d{2}-\d{2})$/);
            if (dailyTitle) {
                return {
                    relPath: `daily/${dailyTitle[1]}.md`,
                    frontmatter: { type: "daily", ...base },
                    body: withLinks(asText(item.body).trim(), item.links),
                    mode: "append",
                };
            }
            {
                const hasStructured = !!(asText(item.what).trim() || asText(item.whyItMatters).trim());
                let captureBody;
                if (hasStructured) {
                    captureBody = joinSections([
                        `# ${asText(item.title)}`,
                        section("What", item.what),
                        section("Why it matters", item.whyItMatters),
                    ]);
                }
                else {
                    captureBody = `# ${asText(item.title)}\n\n${asText(item.body).trim()}`;
                }
                return {
                    relPath: `capture/${item.date}-${slug(item.title)}.md`,
                    frontmatter: { type: "capture", status: "active", tags: ["triage"], ...(item.project ? { project: slug(item.project) } : {}), ...base },
                    body: withLinks(captureBody, item.links),
                    mode: "create",
                };
            }
        }
    }
}
