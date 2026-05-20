import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { route, slug } from "./router.js";
import { writeNote } from "./vaultWriter.js";
import { indexNote } from "./indexer.js";
import { upsertDay } from "./dailyState.js";
import { buildDailyNote } from "./dailyNote.js";
import { dataDir, vaultPath } from "./paths.js";
import { writeFailure } from "./sentinel.js";
import { hybridRecall } from "./recall.js";
import { parseEnvelope } from "./distillRun.js";
import { distillModel } from "./model.js";
import { buildInjectPrompt } from "./injectPrompt.js";
const MAX_INPUT_BYTES = 32 * 1024;
export function sanityCheck(raw) {
    const stripped = raw.replace(/\0/g, "");
    const trimmed = stripped.trim();
    if (trimmed.length === 0) {
        return { ok: false, code: 2, reason: "empty input" };
    }
    if (Buffer.byteLength(stripped, "utf8") > MAX_INPUT_BYTES) {
        return { ok: false, code: 2, reason: "input exceeds 32 KB" };
    }
    if (!/[a-z0-9]/i.test(trimmed)) {
        return { ok: false, code: 2, reason: "no alphanumeric content" };
    }
    return { ok: true, text: stripped };
}
export function detectMode(text, opts) {
    if (opts.verbatim)
        return "verbatim";
    if (opts.distill)
        return "distill";
    if (text.length > 200)
        return "distill";
    if (/\n\s*\n/.test(text))
        return "distill";
    return "verbatim";
}
const INJECT_MARKER = "<!-- superbrain:inject ";
function todayIso() { return new Date().toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }
function injectMarker() {
    return `${INJECT_MARKER}${todayIso()} -->`;
}
function applyInjectProvenance(res, mode) {
    const fm = {
        ...res.frontmatter,
        source: "inject",
        injected_at: nowIso(),
        inject_mode: mode,
    };
    const body = `${injectMarker()}\n${res.body}`;
    return { ...res, frontmatter: fm, body };
}
function appendInjectLog(mode, count, preview) {
    try {
        const stamp = nowIso().replace("T", " ").slice(0, 19);
        const safePreview = preview.replace(/\s+/g, " ").slice(0, 80);
        const line = `[${stamp}] ${mode} | ${count} notes | ${safePreview}\n`;
        fs.appendFileSync(path.join(dataDir(), "inject.log"), line);
    }
    catch { /* best-effort */ }
}
async function writeOne(item, mode) {
    const routed = applyInjectProvenance(route(item), mode);
    const res = writeNote(routed.relPath, {
        frontmatter: routed.frontmatter,
        body: routed.body,
        mode: routed.mode,
    });
    if (!res.ok)
        return null;
    try {
        await indexNote(routed.relPath);
    }
    catch (e) {
        writeFailure(`inject index failed: ${e?.message || e}`);
    }
    return routed.relPath;
}
async function updateDaily(date, sid, routedRel) {
    try {
        upsertDay(date, sid, {
            digestLine: "",
            routedRelPaths: routedRel,
            alsoDid: [],
            openThreads: [],
        });
        const dn = buildDailyNote(date);
        writeNote(dn.relPath, { frontmatter: dn.frontmatter, body: dn.body, mode: dn.mode });
        try {
            await indexNote(dn.relPath);
        }
        catch (e) {
            writeFailure(`inject daily index failed: ${e?.message || e}`);
        }
    }
    catch (e) {
        writeFailure(`inject daily upsert failed: ${e?.message || e}`);
    }
}
function listProjectSlugs() {
    try {
        const dir = path.join(vaultPath(), "projects");
        if (!fs.existsSync(dir))
            return [];
        return fs.readdirSync(dir)
            .filter((f) => f.endsWith(".md"))
            .map((f) => f.replace(/\.md$/, ""));
    }
    catch {
        return [];
    }
}
function callClaudeInject(prompt) {
    const stub = process.env.SUPERBRAIN_DISTILL_STUB;
    if (stub)
        return fs.readFileSync(stub, "utf8");
    return execFileSync("claude", ["--model", distillModel(), "-p", prompt], { encoding: "utf8" });
}
async function gatherRecall(text) {
    try {
        return await hybridRecall(text, 5);
    }
    catch {
        return [];
    }
}
function buildVerbatimItem(text, opts) {
    const date = todayIso();
    const firstLine = text.split(/\n/, 1)[0].trim();
    const title = firstLine.slice(0, 80) || "Injected note";
    if (opts.project) {
        return {
            kind: "project_fact",
            title,
            date,
            project: slug(opts.project),
            body: text.trim(),
            links: [],
        };
    }
    return { kind: "capture", title, date, body: text.trim(), links: [] };
}
export async function runInject(raw, opts = {}) {
    const sane = sanityCheck(raw);
    if (!sane.ok)
        return { ok: false, mode: "verbatim", notes: [], message: sane.reason };
    const mode = detectMode(sane.text, opts);
    if (mode === "verbatim") {
        const item = buildVerbatimItem(sane.text, opts);
        const rel = await writeOne(item, "verbatim");
        if (!rel)
            return { ok: false, mode, notes: [], message: "vault write failed" };
        await updateDaily(item.date, `inject-${Date.now()}`, [rel]);
        appendInjectLog("verbatim", 1, sane.text);
        return { ok: true, mode, notes: [rel] };
    }
    // distill mode
    const recallHits = await gatherRecall(sane.text);
    const projectSlugs = listProjectSlugs();
    const prompt = buildInjectPrompt(sane.text, recallHits, projectSlugs);
    let envelope;
    try {
        envelope = parseEnvelope(callClaudeInject(prompt));
    }
    catch (e) {
        writeFailure(`inject LLM call failed: ${e?.message || e}`);
        envelope = { items: [], openThreads: [], alsoDid: [] };
    }
    if (envelope.items.length === 0) {
        // Task 7 will replace this with verbatim fallback. For now: fail-soft.
        return { ok: false, mode: "distill", notes: [], message: "LLM returned no items (fallback in Task 7)" };
    }
    const written = [];
    for (const item of envelope.items) {
        const rel = await writeOne(item, "distill");
        if (rel)
            written.push(rel);
    }
    await updateDaily(todayIso(), `inject-${Date.now()}`, written);
    appendInjectLog("distill", written.length, sane.text);
    return { ok: written.length > 0, mode: "distill", notes: written };
}
