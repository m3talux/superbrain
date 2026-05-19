import { readDay } from "./dailyState.js";
const wl = (rel) => `[[${rel.replace(/\.md$/, "")}]]`;
export function buildDailyNote(date) {
    const day = readDay(date);
    const sessions = Object.keys(day).sort(); // deterministic order
    const digests = [];
    const links = [];
    const alsoDid = [];
    const threads = [];
    for (const s of sessions) {
        const e = day[s];
        if (e.digestLine)
            digests.push(e.digestLine.trim());
        for (const p of e.routedRelPaths)
            if (!links.includes(p))
                links.push(p);
        for (const a of e.alsoDid)
            if (a && !alsoDid.includes(a))
                alsoDid.push(a);
        for (const t of e.openThreads)
            if (t && !threads.includes(t))
                threads.push(t);
    }
    const sec = (h, lines) => `## ${h}\n\n` + (lines.length ? lines.map((l) => `- ${l}`).join("\n") : "_none_") + "\n";
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
