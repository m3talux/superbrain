#!/usr/bin/env node
import fs from "node:fs";
import { isChild } from "../src/distillerEngine.js";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";
import { appendPromptLine } from "../src/sessionNote.js";
function readStdin() { try {
    return fs.readFileSync(0, "utf8");
}
catch {
    return "";
} }
async function main() {
    if (isChild())
        process.exit(0);
    try {
        let h;
        try {
            h = JSON.parse(readStdin());
        }
        catch {
            process.exit(0);
        }
        const prompt = (h?.prompt || "").trim();
        try {
            if (h?.session_id && prompt)
                appendPromptLine(h.session_id, h?.cwd || process.cwd(), prompt);
        }
        catch { /* turn log is best-effort */ }
        if (!depsPresent(pluginRoot()))
            process.exit(0);
        if (!prompt)
            process.exit(0);
        const { getInjectedSlugs, appendInjectedSlugs } = await import("../src/sessionInjected.js");
        const { logInject } = await import("../src/injectTelemetry.js");
        const { estimateTokens, INJECT_LIMITS, capNoteContribution, truncateToBudget } = await import("../src/injectBudget.js");
        const { resolveProjectSlug } = await import("../src/sessionProject.js");
        const { incrementTurnCount } = await import("../src/turnCounter.js");
        const { buildMiniBrief, shouldFireMiniBrief, readPreferencesCore } = await import("../src/injectWindow.js");
        const { compileInjectionBlock } = await import("../src/preferences.js");
        const sid = h?.session_id || "";
        const cwd = h?.cwd || "";
        const excludeSlugs = sid ? getInjectedSlugs(sid) : [];
        let projectSlug;
        if (cwd) {
            projectSlug = resolveProjectSlug(cwd);
        }
        // Increment turn counter (persisted to disk; hook is a fresh process each call).
        const turnCount = sid ? incrementTurnCount(sid) : 0;
        const { hybridRecall } = await import("../src/recall.js");
        const hits = await hybridRecall(prompt, 5, { projectSlug, excludeSlugs });
        // Build output parts
        const outputParts = [];
        // Mini-brief at turn boundary (periodic refresh of active context).
        let miniBriefText = "";
        if (sid && shouldFireMiniBrief(turnCount)) {
            try {
                const mb = buildMiniBrief(sid, projectSlug);
                if (mb) {
                    miniBriefText = `SuperBrain mini-brief:\n${mb}`;
                    outputParts.push(miniBriefText);
                }
            }
            catch { /* best-effort */ }
        }
        // Recall hits with per-note excerpt cap.
        let recallText = "";
        if (hits.length) {
            if (sid) {
                try {
                    appendInjectedSlugs(sid, hits.map((p) => p.relPath));
                }
                catch { /* best-effort */ }
            }
            const lines = hits.map((p) => {
                const cappedExcerpt = capNoteContribution(p.excerpt);
                return `- [[${p.relPath.replace(/\.md$/, "")}]]${p.headingPath ? " › " + p.headingPath : ""} — ${cappedExcerpt}`;
            });
            recallText = "SuperBrain recall (your vault may already answer this):\n" + lines.join("\n");
            outputParts.push(recallText);
        }
        // Preference core: always appended (pinned), even when recall returns zero hits.
        let prefCoreText = "";
        try {
            const core = readPreferencesCore();
            if (core) {
                prefCoreText = truncateToBudget(core, INJECT_LIMITS.prefCore);
            }
            else {
                // Fallback: compile from preferences.md, capped tighter than legacy 500-token limit.
                const fallback = compileInjectionBlock();
                if (fallback)
                    prefCoreText = truncateToBudget(fallback, INJECT_LIMITS.prefCore);
            }
            if (prefCoreText)
                outputParts.push(prefCoreText);
        }
        catch { /* best-effort */ }
        if (outputParts.length) {
            const additionalContext = outputParts.join("\n");
            process.stdout.write(JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: "UserPromptSubmit",
                    additionalContext,
                },
            }));
            try {
                logInject({
                    hook: "UserPromptSubmit",
                    sid,
                    tokens: {
                        recall: estimateTokens(recallText),
                        preferences: estimateTokens(prefCoreText),
                        openThreads: 0,
                        notices: 0,
                        miniBrief: estimateTokens(miniBriefText),
                    },
                });
            }
            catch { /* best-effort */ }
        }
    }
    catch { /* never disrupt the turn */ }
    process.exit(0);
}
main();
