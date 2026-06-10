import { childrenOf } from "./dailyState.js";

export interface McpText { content: { type: "text"; text: string }[]; }

export async function handleChildren(
  args: { parentSessionId: string; date?: string },
): Promise<McpText> {
  const parent = (args?.parentSessionId || "").trim();
  if (!parent) return { content: [{ type: "text", text: "No parent session id provided." }] };
  const date = args?.date || new Date().toISOString().slice(0, 10);
  const kids = childrenOf(date, parent);
  if (!kids.length) {
    return { content: [{ type: "text", text: `No child sessions for parent "${parent}" on ${date}.` }] };
  }
  const lines = kids.map(({ sessionId, entry }) => {
    const projects = entry.projects?.length
      ? entry.projects.join(", ")
      : (entry.project || "—");
    const threads = entry.openThreads.length ? entry.openThreads.join("; ") : "none";
    return `- ${sessionId} [${projects}] — open: ${threads}`;
  }).join("\n");
  return { content: [{ type: "text", text: `Children of "${parent}" on ${date}:\n${lines}` }] };
}
