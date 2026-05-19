import { hybridRecall, type Pointer } from "./recall.js";

export interface McpText { content: { type: "text"; text: string }[]; }

export async function handleSearch(args: { query: string; k?: number }): Promise<McpText> {
  const q = (args?.query || "").trim();
  const k = Math.min(Math.max(args?.k ?? 8, 1), 20);
  if (!q) return { content: [{ type: "text", text: "No query provided." }] };
  let hits: Pointer[];
  try { hits = await hybridRecall(q, k); } catch { hits = []; }
  if (!hits.length) return { content: [{ type: "text", text: `No results for "${q}".` }] };
  const body = hits.map((p, i) =>
    `${i + 1}. [[${p.relPath.replace(/\.md$/, "")}]]${p.headingPath ? " › " + p.headingPath : ""}\n   ${p.excerpt}`
  ).join("\n");
  return { content: [{ type: "text", text: `SuperBrain results for "${q}":\n${body}` }] };
}
