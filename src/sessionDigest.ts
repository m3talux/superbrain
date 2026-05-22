import path from "node:path";
import { hybridRecall } from "./recall.js";
import { compileInjectionBlock } from "./preferences.js";
import { readDay } from "./dailyState.js";
import { fitToBudget, INJECT_LIMITS } from "./injectBudget.js";
import { classifyPath, basenameSlug } from "./projectDetect.js";

export async function appendDigest(parts: string[], h: any): Promise<void> {
  // Hybrid recall digest: project-slug filtered when cwd resolves to a known project.
  try {
    const cwd: string = h.cwd || "";
    let query: string;
    let recallOpts: { projectSlug?: string } | undefined;

    if (cwd) {
      const classification = classifyPath(cwd);
      if (classification.kind === "single" || classification.kind === "umbrella") {
        const slug = basenameSlug(classification.projectDir);
        query = slug;
        recallOpts = { projectSlug: slug };
      } else {
        // blocked or skip — fall back to bare basename, no project filter
        query = path.basename(cwd);
        recallOpts = undefined;
      }
    } else {
      query = "";
      recallOpts = undefined;
    }

    const hits = await hybridRecall(query, 5, recallOpts);
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
