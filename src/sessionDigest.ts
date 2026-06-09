import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { hybridRecall } from "./recall.js";
import { compileInjectionBlock } from "./preferences.js";
import { readDay } from "./dailyState.js";
import { fitToBudget, INJECT_LIMITS, estimateTokens, truncateToBudget } from "./injectBudget.js";
import { resolveProjectSlug } from "./sessionProject.js";
import { appendInjectedSlugs, getInjectedSlugs } from "./sessionInjected.js";
import { resetTurnCount } from "./turnCounter.js";
import { logInject } from "./injectTelemetry.js";
import { indexDbPath, vaultPath } from "./paths.js";
import { readPreferencesCore } from "./injectWindow.js";

export async function appendDigest(parts: string[], h: any): Promise<void> {
  const sid: string = h.session_id || "";
  let recallProjectText = "";
  let recallGlobalText = "";
  let prefCoreText = "";
  let openThreadsText = "";

  // Reset turn counter so mini-briefs re-start counting from this session begin.
  if (sid) {
    try { resetTurnCount(sid); } catch { /* best-effort */ }
  }

  // Resolve the current project once; reused by recall and open-threads.
  const cwd: string = h.cwd || "";
  let currentProjectSlug: string | undefined;
  let currentProjectKnown = false;
  if (cwd) {
    currentProjectSlug = resolveProjectSlug(cwd);
    currentProjectKnown = currentProjectSlug !== undefined;
  }

  // --- Slot A (~60%): Project anchor via hybrid recall ---
  try {
    if (currentProjectKnown && currentProjectSlug) {
      const projectHits = await hybridRecall(currentProjectSlug, 5, { projectSlug: currentProjectSlug });
      if (projectHits.length) {
        const lines = projectHits.map((p) => `- [[${p.relPath.replace(/\.md$/, "")}]] — ${p.excerpt}`);
        const body = fitToBudget(lines, INJECT_LIMITS.briefProject);
        if (body) {
          recallProjectText = `SuperBrain — ${currentProjectSlug}:\n${body}`;
          parts.push(recallProjectText);
        }
        if (sid) {
          try { appendInjectedSlugs(sid, projectHits.map((p) => p.relPath)); } catch { /* best-effort */ }
        }
      }
    }
  } catch { /* slot A is best-effort */ }

  // --- Slot B (~20%): Semantically relevant global/knowledge notes ---
  try {
    const globalQuery = currentProjectKnown && currentProjectSlug
      ? currentProjectSlug
      : cwd ? path.basename(cwd) : "";

    if (globalQuery) {
      const globalHits = await hybridRecall(globalQuery, 3);
      if (globalHits.length) {
        const injected = sid ? new Set(getInjectedSlugs(sid)) : new Set<string>();
        const dedupedHits = globalHits.filter((p) => !injected.has(p.relPath));
        if (dedupedHits.length) {
          const lines = dedupedHits.map((p) => `- [[${p.relPath.replace(/\.md$/, "")}]] — ${p.excerpt}`);
          const body = fitToBudget(lines, INJECT_LIMITS.briefGlobal);
          if (body) {
            recallGlobalText = "SuperBrain global context:\n" + body;
            parts.push(recallGlobalText);
          }
          if (sid) {
            try { appendInjectedSlugs(sid, dedupedHits.map((p) => p.relPath)); } catch { /* best-effort */ }
          }
        }
      }
    }
  } catch { /* slot B is best-effort */ }

  // --- Slot C (fixed ~100 tok): Preference core (pinned) ---
  // Read preferences-core.md (B3 output); gracefully fall back to compileInjectionBlock.
  try {
    const coreContent = readPreferencesCore();
    if (coreContent) {
      const capped = truncateToBudget(coreContent, INJECT_LIMITS.prefCore);
      prefCoreText = `--- Preferences (core) ---\n${capped}\n---`;
    } else {
      // B3 not yet shipped: fall back to compileInjectionBlock, capped tighter
      const fallback = compileInjectionBlock();
      if (fallback) {
        prefCoreText = truncateToBudget(fallback, INJECT_LIMITS.prefCore);
      }
    }
    if (prefCoreText) parts.push(prefCoreText);
  } catch { /* preferences are best-effort */ }

  // --- Slot D (optional): Open threads from today's daily state ---
  try {
    const today = new Date().toISOString().slice(0, 10);
    const day = readDay(today);
    const threads: string[] = [];
    if (currentProjectKnown && currentProjectSlug) {
      for (const s of Object.keys(day)) {
        const entry = day[s];
        const entryProject = entry.project;
        if (entryProject !== undefined && entryProject !== currentProjectSlug) continue;
        for (const t of entry.openThreads) if (t && !threads.includes(t)) threads.push(t);
      }
    }
    if (threads.length) {
      const threadLines = threads.map((t) => `- ${t}`);
      const body = fitToBudget(threadLines, INJECT_LIMITS.openThreads);
      if (body) {
        openThreadsText = "SuperBrain — open threads today:\n" + body;
        parts.push(openThreadsText);
      }
    }
  } catch { /* open threads are best-effort */ }

  // Migration notice — one-time per version, version-gated via sentinel file.
  let noticesText = "";
  try {
    const version = process.env.npm_package_version || (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "package.json"), "utf8"));
        return pkg.version as string;
      } catch { return "unknown"; }
    })();
    const sentinelFile = path.join(os.homedir(), ".superbrain", `migration-prompted-${version}.txt`);
    if (!fs.existsSync(sentinelFile)) {
      const { detectLegacyState } = await import("./migrationDetect.js");
      const vault = vaultPath();
      const db = indexDbPath();
      const state = await detectLegacyState(vault, db);
      if (state.edgesEmpty || state.preferencesOverCap) {
        const notice =
          `SuperBrain v${version}: legacy vault state detected. ` +
          `Run \`npx sb-doctor migrate-all\` to migrate legacy notes to the v0.5 templates (~5 min, reversible via .trash/migration-<date>/).`;
        noticesText = truncateToBudget(notice, INJECT_LIMITS.notices);
        parts.push(noticesText);
        fs.mkdirSync(path.dirname(sentinelFile), { recursive: true });
        fs.writeFileSync(sentinelFile, new Date().toISOString() + "\n", "utf8");
      }
    }
  } catch { /* migration notice is best-effort */ }

  // Telemetry — never blocks startup.
  try {
    logInject({
      hook: "SessionStart",
      sid,
      tokens: {
        recall: estimateTokens(recallProjectText) + estimateTokens(recallGlobalText),
        preferences: estimateTokens(prefCoreText),
        openThreads: estimateTokens(openThreadsText),
        notices: estimateTokens(noticesText),
        miniBrief: 0,
      },
    });
  } catch { /* best-effort */ }
}
