import matter from "gray-matter";

const VALID_TYPES = ["project", "person", "decision", "capture", "daily", "map", "summary"];
const VALID_STATUS = ["active", "paused", "done", "archived"];

export function parseNote(raw: string): { data: Record<string, any>; content: string } {
  const g = matter(raw);
  return { data: g.data || {}, content: g.content || "" };
}
export function serializeNote(data: Record<string, any>, content: string): string {
  return matter.stringify(content.endsWith("\n") ? content : content + "\n", data);
}
export function validateFrontmatter(data: Record<string, any>): string[] {
  const errs: string[] = [];
  if (!data.type || !VALID_TYPES.includes(data.type)) errs.push(`type must be one of ${VALID_TYPES.join("|")}`);
  if (data.type && !["daily", "map", "summary"].includes(data.type)) {
    if (!data.status || !VALID_STATUS.includes(data.status)) errs.push(`status must be one of ${VALID_STATUS.join("|")}`);
  }
  for (const [k, v] of Object.entries(data)) {
    const t = typeof v;
    if (t === "function" || t === "symbol" || t === "undefined") errs.push(`frontmatter key "${k}" is not serializable`);
  }
  return errs;
}
