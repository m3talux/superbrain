import { hybridRecall } from "./recall.js";
export async function handleSearch(args) {
    const q = (args?.query || "").trim();
    const k = Math.min(Math.max(args?.k ?? 8, 1), 20);
    if (!q)
        return { content: [{ type: "text", text: "No query provided." }] };
    const opts = {
        projectSlug: args.project?.trim() || undefined,
        type: args.type?.trim() || undefined,
        since: args.since?.trim() || undefined,
        role: args.role?.trim() || undefined,
    };
    let hits;
    try {
        hits = await hybridRecall(q, k, opts);
    }
    catch {
        hits = [];
    }
    if (!hits.length)
        return { content: [{ type: "text", text: `No results for "${q}".` }] };
    const body = hits.map((p, i) => `${i + 1}. [[${p.relPath.replace(/\.md$/, "")}]]${p.headingPath ? " › " + p.headingPath : ""}\n   ${p.excerpt}`).join("\n");
    return { content: [{ type: "text", text: `SuperBrain results for "${q}":\n${body}` }] };
}
