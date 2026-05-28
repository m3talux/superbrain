import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { hybridRecall } from "./recall.js";
import { compileInjectionBlock } from "./preferences.js";
import { readDay } from "./dailyState.js";
import { fitToBudget, INJECT_LIMITS, estimateTokens, truncateToBudget } from "./injectBudget.js";
import { classifyPath, basenameSlug } from "./projectDetect.js";
import { appendInjectedSlugs } from "./sessionInjected.js";
import { logInject } from "./injectTelemetry.js";
import { dataDir, vaultPath } from "./paths.js";

export async function appendDigest(parts: string[], h: any): Promise<void> {
  const sid: string = h.session_id || "";
  let recallText = "";
  let preferencesText = "";
  let openThreadsText = "";

  // Resolve the current project once; reused by both recall and open-threads.
  const cwd: string = h.cwd || "";
  let currentProjectSlug: string | undefined;
  let currentProjectKnown = false; // true only when cwd maps to a concrete project
  if (cwd) {
    const classification = classifyPath(cwd);
    if (classification.kind === "single" || classification.kind === "umbrella") {
      currentProjectSlug = basenameSlug(classification.projectDir);
      currentProjectKnown = true;
    }
  }

  // Project-scoped session brief: leads additionalContext when we know the project.
  try {
    if (currentProjectKnown && currentProjectSlug) {
      let lastDigestLine = "";
      const recentSlugs: string[] = [];

      // Scan the last 7 calendar days newest-first for this project's activity.
      for (let i = 1; i <= 7; i++) {
        const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        const day = readDay(d);
        for (const entry of Object.values(day)) {
          if (entry.project !== currentProjectSlug) continue;
          if (!lastDigestLine && entry.digestLine) lastDigestLine = entry.digestLine;
          for (const r of entry.routedRelPaths) {
            const slug = path.basename(r, ".md");
            if (!recentSlugs.includes(slug) && recentSlugs.length < 3) recentSlugs.push(slug);
          }
        }
        if (lastDigestLine && recentSlugs.length >= 3) break;
      }

      if (lastDigestLine) {
        const lines = [
          `Tell the user in one sentence that SuperBrain has loaded context for this project.`,
          `SuperBrain — ${currentProjectSlug}`,
          `Last session: ${lastDigestLine}`,
        ];
        if (recentSlugs.length) lines.push(`Recent: ${recentSlugs.join(", ")}`);
        const body = fitToBudget(lines, INJECT_LIMITS.brief);
        if (body) parts.unshift(body);
      }
    }
  } catch { /* brief is best-effort */ }

  // Hybrid recall digest: project-slug filtered when cwd resolves to a known project.
  try {
    let query: string;
    let recallOpts: { projectSlug?: string } | undefined;

    if (currentProjectKnown && currentProjectSlug) {
      query = currentProjectSlug;
      recallOpts = { projectSlug: currentProjectSlug };
    } else if (cwd) {
      // blocked or skip — fall back to bare basename, no project filter
      query = path.basename(cwd);
      recallOpts = undefined;
    } else {
      query = "";
      recallOpts = undefined;
    }

    const hits = await hybridRecall(query, 5, recallOpts);
    if (hits.length) {
      const lines = hits.map((p) => `- [[${p.relPath.replace(/\.md$/, "")}]] — ${p.excerpt}`);
      const body = fitToBudget(lines, INJECT_LIMITS.recall);
      if (body) {
        recallText = "SuperBrain memory — relevant past notes:\n" + body;
        parts.push(recallText);
      }
      // Record injected paths so UserPromptSubmit can exclude them.
      if (sid) {
        try { appendInjectedSlugs(sid, hits.map((p) => p.relPath)); } catch { /* best-effort */ }
      }
    }
  } catch { /* recall is best-effort */ }

  // Preferences + today's open threads (best-effort, never blocks startup).
  try {
    const pref = compileInjectionBlock();
    if (pref) {
      preferencesText = pref;
      parts.push(preferencesText);
    }
    const today = new Date().toISOString().slice(0, 10);
    const day = readDay(today);
    const threads: string[] = [];
    if (currentProjectKnown && currentProjectSlug) {
      for (const s of Object.keys(day)) {
        const entry = day[s];
        const entryProject = entry.project;
        // Include: same project, or unscoped (no project field). Exclude: different concrete project.
        if (entryProject !== undefined && entryProject !== currentProjectSlug) continue;
        for (const t of entry.openThreads) if (t && !threads.includes(t)) threads.push(t);
      }
    }
    // If cwd has no project (blocked/skip), threads stays empty — no cross-project noise.
    if (threads.length) {
      const threadLines = threads.map((t) => `- ${t}`);
      const body = fitToBudget(threadLines, INJECT_LIMITS.openThreads);
      if (body) {
        openThreadsText = "SuperBrain — open threads today:\n" + body;
        parts.push(openThreadsText);
      }
    }
  } catch { /* personalization is best-effort */ }

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
      // Dynamically import detectLegacyState (heavy dep, keeps this file import-safe at startup)
      const { detectLegacyState } = await import("./migrationDetect.js");
      const vault = vaultPath();
      const db = path.join(dataDir(), "index.db");
      const state = await detectLegacyState(vault, db);
      if (state.edgesEmpty || state.preferencesOverCap) {
        const notice =
          `SuperBrain v${version}: legacy vault state detected. ` +
          `Run \`npx sb-doctor migrate-all\` to migrate legacy notes to the v0.5 templates (~5 min, reversible via .trash/migration-<date>/).`;
        noticesText = truncateToBudget(notice, INJECT_LIMITS.notices);
        parts.push(noticesText);
        // Write sentinel so this notice is never shown again for this version
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
        recall: estimateTokens(recallText),
        preferences: estimateTokens(preferencesText),
        openThreads: estimateTokens(openThreadsText),
        notices: estimateTokens(noticesText),
      },
    });
  } catch { /* best-effort */ }
}
