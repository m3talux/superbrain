import matter from "gray-matter";
const VALID_TYPES = ["project", "person", "decision", "capture", "daily", "map", "summary", "lesson", "preference"];
const VALID_STATUS = ["active", "paused", "done", "archived"];
// Types whose route always supplies project: — only these are enforced
const PROJECT_REQUIRED = new Set(["project"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDates(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
        if (v instanceof Date) {
            out[k] = v.toISOString().slice(0, 10);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
export function parseNote(raw) {
    const g = matter(raw);
    return { data: normalizeDates(g.data || {}), content: g.content || "" };
}
export function serializeNote(data, content) {
    if (!data.type)
        throw new Error("required: type");
    if (PROJECT_REQUIRED.has(data.type) && !data.project)
        throw new Error("required: project");
    let yaml = matter.stringify(content.endsWith("\n") ? content : content + "\n", data);
    // Strip quotes around date-shaped values for known date keys
    yaml = yaml.replace(/^(created|date|last_touched|superseded_at): ['"](\d{4}-\d{2}-\d{2})['"]$/gm, "$1: $2");
    return yaml;
}
export function validateFrontmatter(data) {
    const errs = [];
    if (!data.type || !VALID_TYPES.includes(data.type))
        errs.push(`type must be one of ${VALID_TYPES.join("|")}`);
    if (data.type && !["daily", "map", "summary", "preference"].includes(data.type)) {
        if (!data.status || !VALID_STATUS.includes(data.status))
            errs.push(`status must be one of ${VALID_STATUS.join("|")}`);
    }
    for (const [k, v] of Object.entries(data)) {
        const t = typeof v;
        if (t === "function" || t === "symbol" || t === "undefined")
            errs.push(`frontmatter key "${k}" is not serializable`);
    }
    return errs;
}
