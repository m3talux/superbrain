import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
// Pin the model on every detached `claude -p` distill/rollup spawn so it never
// inherits the user's session model (which is often Opus, and burns daily
// quota in hours — exactly the legacy-scribe bug we replaced). Sonnet 4.6
// balances quality (the distiller IS the product — the vault is only as good
// as the routed notes it writes) against cost (~1/5 of Opus). No env override:
// users should not need to think about model selection.
export function distillModel() {
    return "claude-sonnet-4-6";
}
function callClaude(prompt) {
    return execFileSync("claude", ["--model", distillModel(), "-p", prompt], { encoding: "utf8" });
}
import { readDelta } from "./ndjson.js";
import { readCursor, writeCursor } from "./cursor.js";
import { route } from "./router.js";
import { writeNote } from "./vaultWriter.js";
import { releaseLock } from "./lockfile.js";
import { writeFailure } from "./sentinel.js";
import { logFilePath } from "./paths.js";
import { markRollup } from "./rollupState.js";
import { indexNote } from "./indexer.js";
import { upsertDay } from "./dailyState.js";
import { buildDailyNote } from "./dailyNote.js";
import { preferencesPath } from "./preferences.js";
export function parseEnvelope(raw) {
    let v;
    try {
        const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        v = JSON.parse(m ? m[0] : raw);
    }
    catch {
        return { items: [], openThreads: [], alsoDid: [] };
    }
    if (Array.isArray(v))
        return { items: v, openThreads: [], alsoDid: [] };
    return {
        items: Array.isArray(v.items) ? v.items : [],
        digest: typeof v.digest === "string" ? v.digest : undefined,
        openThreads: Array.isArray(v.openThreads) ? v.openThreads : [],
        alsoDid: Array.isArray(v.alsoDid) ? v.alsoDid : [],
    };
}
// The session-distillation prompt. Long and opinionated on purpose: prompt
// quality is the whole game. Structure: persona → hard rules → per-kind
// emission criteria → per-kind required fields → few-shot examples →
// preferences reconciliation contract → output schema → events.
const DISTILL_PROMPT_PREFIX = `You are SuperBrain's distiller. You receive a JSON array of session events (tool calls, prompts) plus 'pushback' markers, and you turn the substantive moments into durable second-brain notes. Many sessions contain NO substantive moments — that is the desired output, not a failure.

# Hard rules — never violate

1. If the events array is empty OR contains no substantive activity (skim-only sessions, observer-watches-observer meta-sessions, sessions that only read existing notes), output {"items":[]} immediately and stop.
2. Distiller behavior rules (this prompt) are NOT user preferences. NEVER write them into a preference item.
3. Skip transcript dumps and anything trivially derivable from git or the code itself (file paths, function names, commit messages alone are not knowledge).
4. Output ONLY the JSON envelope. No prose, no backticks, no explanation.

# Quality bar — wait for signal before emitting

Each kind has a concrete threshold. If a session does not meet the threshold for any kind, do not invent items. Empty output is correct.

- decision — emit only when the session contains an EXPLICIT deliberation (multiple options weighed and a trade-off chosen) OR a documented multi-step plan with stated reasoning. A one-line conclusion is not a decision.
- gotcha — emit only when a bug was REPRODUCED AND DIAGNOSED AND has a stated fix or workaround. Speculation, suspicion, or 'this might be the issue' is not a gotcha.
- lesson — emit only when user pushback produces a GENERALIZABLE RULE that should change future behavior. A one-off correction ('not that file, the other one') is not a lesson.
- project_fact — emit only for DURABLE architectural, scope, or ownership statements. 'PR in review' is not a project fact. 'We've decided this service will be the only writer for X' is.
- preference — emit only when the user EXPLICITLY states a coding / tooling / communication preference, OR sustained pushback reveals one. Preferences describe how the USER wants Claude to behave (code style, architecture, tool choice, comment density, etc.). NEVER describe SuperBrain's own distiller behavior here.
- person — emit only when a durable role / context / thread about a specific person is established.
- capture — only for substantive items that don't fit above but are clearly worth keeping. Not a dumping ground.

# Required fields per kind — write rich, structured notes

When you DO emit, fill the structured fields below. Substance over brevity: a real decision note is paragraphs, not a sentence.

decision: { kind, title (imperative, ≤80 chars), date, context (1–2 paragraphs: what was happening, what choice arose), decision (1–2 sentences: what was chosen), rationale (1–2 paragraphs: why this over alternatives), consequences (1 paragraph: trade-offs, what this enables or precludes), implementation? (concrete next steps or changes made), project? (slug if scoped), links (related-note slugs) }

gotcha: { kind, title (short symptom name), date, project (slug — required), symptom (the observable failure), rootCause (technical explanation), fix (what resolves it, with file refs if possible), prevention (how to avoid hitting it again), links }

lesson: { kind, title (short imperative rule name), date, rule (the durable, generalizable principle, one crisp sentence), why (the reasoning + the incident that produced it, 1–2 paragraphs), whenApplies (when to invoke this rule in the future), links }

project_fact: { kind, title (short fact statement), date, project (slug — required), body (one sentence of context + the fact itself; ≤3 sentences), links }

person: { kind, title (short), date, person (slug — required), body (role/context/threads), links }

preference: { kind, title: "Preferences", date, body (the FULL reconciled user-preferences doc — plain markdown, organized by '## Category' headings such as Code style / Architecture / Tools / Communication, NEVER containing SuperBrain distiller behavior) }

capture: { kind, title, date, body, links }

# Preferences reconciliation

You are given the current preferences doc at the end of this prompt. When a lesson's rule qualifies as a user-style/tool/communication preference (NOT a SuperBrain behavior rule), ALSO emit exactly one preference item whose body is the FULL reconciled doc — integrate the new rule, dedupe, resolve contradictions newest-wins, keep '## Category' headings. Never emit more than one preference item per envelope. If the lesson is a SuperBrain behavior rule, do not emit a preference at all.

# Few-shot — what a substantive decision and lesson look like

EXAMPLE decision (structured fields filled, paragraphs, links):
{"kind":"decision","title":"Pin distiller model to Sonnet 4.6","date":"2026-05-19","context":"The legacy scribe ran detached \`claude -p\` spawns at the user's session model, often Opus. Distillation runs many times per day and burned the user's daily Opus quota in hours, surfacing as silent capture failures mid-day.","decision":"Hardcode the distiller and rollup spawns to use --model claude-sonnet-4-6 unconditionally; no env override.","rationale":"Sonnet 4.6 produces judgment of comparable quality to Opus for summarization at roughly 1/5 the cost. Removing the env override prevents users from accidentally re-introducing the quota burn — the surface area was a footgun, not a feature.","consequences":"Users who want higher quality must set ANTHROPIC_API_KEY to bypass subscription quota. No model selection is exposed beyond that escape hatch.","implementation":"src/distillRun.ts:distillModel() returns the literal 'claude-sonnet-4-6'. tests/distillModel.test.ts locks the no-env behavior in.","links":["projects/superbrain"]}

EXAMPLE lesson (structured fields, traced to an incident, with whenApplies):
{"kind":"lesson","title":"Verify the live data dir before claiming a plugin is broken","date":"2026-05-20","rule":"For Claude Code plugins, resolve the actual CLAUDE_PLUGIN_DATA path at hook execution time before inspecting on-disk state — never trust the fallback path in the source code.","why":"On 2026-05-20 a full multi-step misdiagnosis was produced (broken matchers, async hook failure, missing distillation) because the investigator inspected the source's fallback ~/.superbrain/ instead of the actual ~/.claude/plugins/data/superbrain-m3talux/ where Claude Code routes hook writes. Everything was healthy at the real path.","whenApplies":"Any time a Claude Code plugin appears to not be writing data, before declaring it broken.","links":["projects/superbrain"]}

# Output schema

{"items": [ <items as above> ], "digest"?: "<=1 sentence of the session's arc", "openThreads"?: ["unfinished/deferred work"], "alsoDid"?: ["notable work that did not become a knowledge item"]}

# Events

`;
function getEnvelope(deltaJson) {
    const stub = process.env.SUPERBRAIN_DISTILL_STUB;
    if (stub)
        return parseEnvelope(fs.readFileSync(stub, "utf8"));
    let curPrefs = "";
    try {
        curPrefs = fs.readFileSync(preferencesPath(), "utf8");
    }
    catch { /* none yet */ }
    const fullPrompt = DISTILL_PROMPT_PREFIX +
        deltaJson +
        "\n\n# Current preferences (reconcile, do not lose existing user preferences; never include distiller behavior here)\n\n" +
        (curPrefs || "(none yet)");
    const out = callClaude(fullPrompt);
    return parseEnvelope(out);
}
function appendLog(title, rel) {
    // Per-day .log file in dataDir/logs/. Not in the vault — it's system
    // telemetry, not a note. One file per day caps unbounded growth and makes
    // the daily rollup input trivially scoped to its day.
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const stamp = now.toISOString().slice(0, 16).replace("T", " ");
    const p = logFilePath(date);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `[${stamp}] write | ${title} | ${rel.replace(/\.md$/, "")}\n`);
}
function getRollupItems(logContent, key) {
    const stub = process.env.SUPERBRAIN_DISTILL_STUB;
    if (stub)
        return parseEnvelope(fs.readFileSync(stub, "utf8")).items;
    const prompt = `You are SuperBrain's daily rollup synthesizer. Given this activity log for ${key}, ` +
        'output ONLY a JSON object {"items":[{"kind":"capture","title":"Daily ' + key + '",' +
        `"body":"<synthesis>","date":"${key}","links":[]}]}. Activity log:\n` + logContent;
    const out = callClaude(prompt);
    return parseEnvelope(out).items;
}
export async function runRollup(rollupEnv) {
    // Format: daily:<key>:<hash>
    const parts = rollupEnv.split(":");
    // parts[0] = "daily", parts[1] = key (YYYY-MM-DD), parts[2] = hash
    const kind = parts[0];
    const key = parts[1];
    const hash = parts[2];
    try {
        const logFile = logFilePath(key);
        let logContent = "";
        try {
            logContent = fs.readFileSync(logFile, "utf8");
        }
        catch { /* absent is fine */ }
        const items = getRollupItems(logContent, key);
        const env = parseEnvelope(process.env.SUPERBRAIN_DISTILL_STUB
            ? fs.readFileSync(process.env.SUPERBRAIN_DISTILL_STUB, "utf8") : "{}");
        const routed = [];
        for (const it of items) {
            const r = route(it);
            const res = writeNote(r.relPath, { frontmatter: r.frontmatter, body: r.body, mode: r.mode });
            if (res.ok) {
                appendLog(it.title || it.kind, r.relPath);
                try {
                    await indexNote(r.relPath);
                }
                catch (e) {
                    writeFailure(`index failed: ${e?.message || e}`);
                }
                routed.push(r.relPath);
            }
        }
        try {
            upsertDay(key, `rollup-${key}`, {
                digestLine: env.digest || "", routedRelPaths: routed,
                alsoDid: env.alsoDid || [], openThreads: env.openThreads || [],
            });
            const dn = buildDailyNote(key);
            writeNote(dn.relPath, { frontmatter: dn.frontmatter, body: dn.body, mode: dn.mode });
            try {
                await indexNote(dn.relPath);
            }
            catch (e) {
                writeFailure(`index failed: ${e?.message || e}`);
            }
        }
        catch (e) {
            writeFailure(`daily note failed: ${e?.message || e}`);
        }
        // Mark rollup complete only on success
        markRollup(kind, key, hash);
    }
    catch (e) {
        writeFailure(`distill rollup failed: ${e?.message || e}`);
    }
    finally {
        releaseLock("distill");
    }
}
export async function runDistill() {
    const sid = process.env.SUPERBRAIN_SESSION_ID
        || (() => { try {
            return JSON.parse(fs.readFileSync(0, "utf8")).session_id;
        }
        catch {
            return "unknown";
        } })();
    try {
        const from = readCursor(sid);
        const { events, newOffset } = readDelta(sid, from);
        if (events.length === 0) {
            releaseLock("distill");
            process.exit(0);
        }
        const env = getEnvelope(JSON.stringify(events));
        const items = env.items;
        const routedByDate = {};
        for (const it of items) {
            const r = route(it);
            const res = writeNote(r.relPath, { frontmatter: r.frontmatter, body: r.body, mode: r.mode });
            if (res.ok) {
                appendLog(it.title || it.kind, r.relPath);
                try {
                    await indexNote(r.relPath);
                }
                catch (e) {
                    writeFailure(`index failed: ${e?.message || e}`);
                }
                (routedByDate[it.date] ||= []).push(r.relPath);
            }
        }
        // Daily journal: record this session's contribution + regenerate the note(s).
        try {
            const dates = Object.keys(routedByDate);
            const today = new Date().toISOString().slice(0, 10);
            for (const d of dates.length ? dates : [today]) {
                upsertDay(d, sid, {
                    digestLine: env.digest || "",
                    routedRelPaths: routedByDate[d] || [],
                    alsoDid: env.alsoDid,
                    openThreads: env.openThreads,
                });
                const dn = buildDailyNote(d);
                writeNote(dn.relPath, { frontmatter: dn.frontmatter, body: dn.body, mode: dn.mode });
                try {
                    await indexNote(dn.relPath);
                }
                catch (e) {
                    writeFailure(`index failed: ${e?.message || e}`);
                }
            }
        }
        catch (e) {
            writeFailure(`daily note failed: ${e?.message || e}`);
        }
        writeCursor(sid, newOffset);
    }
    catch (e) {
        writeFailure(`distill failed: ${e?.message || e}`);
    }
    finally {
        releaseLock("distill");
    }
}
