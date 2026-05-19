import { readDay } from "./dailyState.js";

export interface DailyResult {
  relPath: string;
  frontmatter: Record<string, any>;
  body: string;
  mode: "replace";
}

const wl = (rel: string) => `[[${rel.replace(/\.md$/, "")}]]`;

export function buildDailyNote(date: string): DailyResult {
  const day = readDay(date);
  const sessions = Object.keys(day).sort();          // deterministic order
  const digests: string[] = [];
  const links: string[] = [];
  const alsoDid: string[] = [];
  const threads: string[] = [];
  for (const s of sessions) {
    const e = day[s];
    if (e.digestLine) digests.push(e.digestLine.trim());
    for (const p of e.routedRelPaths) if (!links.includes(p)) links.push(p);
    for (const a of e.alsoDid) if (a && !alsoDid.includes(a)) alsoDid.push(a);
    for (const t of e.openThreads) if (t && !threads.includes(t)) threads.push(t);
  }
  const sec = (h: string, lines: string[]) =>
    `## ${h}\n\n` + (lines.length ? lines.map((l) => `- ${l}`).join("\n") : "_none_") + "\n";
  const body = [
    `# ${date}`,
    "",
    `## Summary\n\n${digests.length ? digests.map((d) => `- ${d}`).join("\n") : "_none_"}`,
    "",
    sec("Decisions & gotchas", links.map(wl)),
    sec("Also did", alsoDid),
    sec("Threads open", threads),
  ].join("\n").replace(/\n+$/, "") + "\n";
  return { relPath: `daily/${date}.md`, frontmatter: { type: "daily", created: date, updated: date }, body, mode: "replace" };
}
