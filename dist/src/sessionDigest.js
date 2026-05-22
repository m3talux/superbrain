import path from "node:path";
import { hybridRecall } from "./recall.js";
import { compileInjectionBlock } from "./preferences.js";
import { readDay } from "./dailyState.js";
import { fitToBudget, INJECT_LIMITS, estimateTokens } from "./injectBudget.js";
import { classifyPath, basenameSlug } from "./projectDetect.js";
import { appendInjectedSlugs } from "./sessionInjected.js";
import { logInject } from "./injectTelemetry.js";
export async function appendDigest(parts, h) {
    const sid = h.session_id || "";
    let recallText = "";
    let preferencesText = "";
    let openThreadsText = "";
    // Hybrid recall digest: project-slug filtered when cwd resolves to a known project.
    try {
        const cwd = h.cwd || "";
        let query;
        let recallOpts;
        if (cwd) {
            const classification = classifyPath(cwd);
            if (classification.kind === "single" || classification.kind === "umbrella") {
                const slug = basenameSlug(classification.projectDir);
                query = slug;
                recallOpts = { projectSlug: slug };
            }
            else {
                // blocked or skip — fall back to bare basename, no project filter
                query = path.basename(cwd);
                recallOpts = undefined;
            }
        }
        else {
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
                try {
                    appendInjectedSlugs(sid, hits.map((p) => p.relPath));
                }
                catch { /* best-effort */ }
            }
        }
    }
    catch { /* recall is best-effort */ }
    // Preferences + today's open threads (best-effort, never blocks startup).
    try {
        const pref = compileInjectionBlock();
        if (pref) {
            preferencesText = pref;
            parts.push(preferencesText);
        }
        const today = new Date().toISOString().slice(0, 10);
        const day = readDay(today);
        const threads = [];
        for (const s of Object.keys(day))
            for (const t of day[s].openThreads)
                if (t && !threads.includes(t))
                    threads.push(t);
        if (threads.length) {
            const threadLines = threads.map((t) => `- ${t}`);
            const body = fitToBudget(threadLines, INJECT_LIMITS.openThreads);
            if (body) {
                openThreadsText = "SuperBrain — open threads today:\n" + body;
                parts.push(openThreadsText);
            }
        }
    }
    catch { /* personalization is best-effort */ }
    // Telemetry — never blocks startup.
    try {
        logInject({
            hook: "SessionStart",
            sid,
            tokens: {
                recall: estimateTokens(recallText),
                preferences: estimateTokens(preferencesText),
                openThreads: estimateTokens(openThreadsText),
                notices: 0,
            },
        });
    }
    catch { /* best-effort */ }
}
