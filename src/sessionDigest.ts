import path from "node:path";
import { hybridRecall } from "./recall.js";
import { compileInjectionBlock } from "./preferences.js";
import { readDay } from "./dailyState.js";
import { fitToBudget, INJECT_LIMITS } from "./injectBudget.js";

export async function appendDigest(parts: string[], h: any): Promise<void> {
  // Hybrid recall digest (cwd/recent-topic seeded). Tiered: pointers, not bodies.
  try {
    const seed = `${path.basename(h.cwd || "")} recent work decisions gotchas`.trim();
    const hits = await hybridRecall(seed, 5);
    if (hits.length) {
      const lines = hits.map((p) => `- [[${p.relPath.replace(/\.md$/, "")}]] — ${p.excerpt}`);
      const body = fitToBudget(lines, INJECT_LIMITS.recall);
      if (body) parts.push("SuperBrain memory — relevant past notes:\n" + body);
    }
  } catch { /* recall is best-effort */ }

  // Preferences + today's open threads (best-effort, never blocks startup).
  try {
    const pref = compileInjectionBlock();
    if (pref) parts.push(pref);
    const today = new Date().toISOString().slice(0, 10);
    const day = readDay(today);
    const threads: string[] = [];
    for (const s of Object.keys(day))
      for (const t of day[s].openThreads) if (t && !threads.includes(t)) threads.push(t);
    if (threads.length) {
      const threadLines = threads.map((t) => `- ${t}`);
      const body = fitToBudget(threadLines, INJECT_LIMITS.openThreads);
      if (body) parts.push("SuperBrain — open threads today:\n" + body);
    }
  } catch { /* personalization is best-effort */ }
}
