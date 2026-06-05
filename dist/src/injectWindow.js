import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { truncateToBudget, INJECT_LIMITS, PER_NOTE_TOKEN_CAP } from "./injectBudget.js";
import { parseNote } from "./frontmatter.js";
/** The env-overridable period for mini-brief injection (every N turns). */
export const MINI_BRIEF_EVERY = (() => {
    const v = parseInt(process.env.SUPERBRAIN_MINI_BRIEF_EVERY ?? "", 10);
    return Number.isFinite(v) && v > 0 ? v : 10;
})();
/**
 * Cap a single note excerpt to the per-note token cap.
 * Prevents any single note from crowding out others in the injection window.
 */
export function capNoteExcerpt(excerpt, cap = PER_NOTE_TOKEN_CAP) {
    return truncateToBudget(excerpt, cap);
}
/**
 * Read the preferences-core file (B3 output) if it exists.
 * Returns empty string if absent (graceful fallback path).
 */
export function readPreferencesCore() {
    try {
        const p = path.join(vaultPath(), "meta", "preferences-core.md");
        return fs.readFileSync(p, "utf8").trim();
    }
    catch {
        return "";
    }
}
/**
 * Build a compact mini-brief for periodic re-injection every MINI_BRIEF_EVERY turns.
 * All reads are best-effort; returns empty string on any failure.
 */
export function buildMiniBrief(_sid, projectSlug, opts = {}) {
    const parts = [];
    const includePrefs = opts.includePrefsCore !== false;
    // Project summary: first non-empty body line from the project note
    if (projectSlug) {
        try {
            const notePath = path.join(vaultPath(), "projects", `${projectSlug}.md`);
            const raw = fs.readFileSync(notePath, "utf8");
            const parsed = parseNote(raw);
            const title = parsed.data.title;
            const firstLine = parsed.content.split("\n").find((l) => l.trim().length > 0);
            const summary = title ?? firstLine ?? projectSlug;
            parts.push(`Project: ${summary}`);
        }
        catch { /* best-effort */ }
    }
    // Most recent daily note title
    try {
        const today = new Date().toISOString().slice(0, 10);
        const dailyPath = path.join(vaultPath(), "daily", `${today}.md`);
        const raw = fs.readFileSync(dailyPath, "utf8");
        const parsed = parseNote(raw);
        const title = parsed.data.title;
        const firstLine = parsed.content.split("\n").find((l) => l.trim().length > 0);
        if (title || firstLine)
            parts.push(`Today: ${title ?? firstLine}`);
    }
    catch { /* best-effort */ }
    // Preference core snippet
    if (includePrefs) {
        const core = readPreferencesCore();
        if (core) {
            const capped = truncateToBudget(core, Math.floor(INJECT_LIMITS.miniBrief / 2));
            parts.push(capped);
        }
    }
    if (parts.length === 0)
        return "";
    const raw = parts.join("\n");
    return truncateToBudget(raw, INJECT_LIMITS.miniBrief);
}
/**
 * Read turn count from the sessions data dir (used by sessionDigest / sb-recall).
 * Delegates actual persistence to turnCounter.ts but provides the MINI_BRIEF_EVERY constant.
 */
export function shouldFireMiniBrief(turnCount) {
    return turnCount > 0 && turnCount % MINI_BRIEF_EVERY === 0;
}
