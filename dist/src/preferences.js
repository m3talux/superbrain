import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { parseNote } from "./frontmatter.js";
import { truncateToBudget, INJECT_LIMITS, estimateTokens } from "./injectBudget.js";
import { atomicWrite } from "./atomicWrite.js";
const CAP_BYTES = 3072;
const SENTINEL = "\n[…truncated; see meta/preferences.md]\n";
export function capPreferences(content) {
    // Token cap (logical truth): apply first so the channel never exceeds its
    // allotted token budget regardless of encoding. The byte cap below acts as
    // belt-and-braces for multibyte / ASCII-heavy content where bytes > chars.
    // Both caps apply independently; whichever fires (or both) appends the sentinel.
    let truncated = false;
    const tokenCapped = truncateToBudget(content, INJECT_LIMITS.preferences);
    if (tokenCapped.length < content.length) {
        content = tokenCapped;
        truncated = true;
    }
    if (Buffer.byteLength(content, "utf8") > CAP_BYTES) {
        const sentinelBytes = Buffer.byteLength(SENTINEL, "utf8");
        const budget = CAP_BYTES - sentinelBytes;
        let out = content;
        while (Buffer.byteLength(out, "utf8") > budget) {
            out = out.slice(0, -1);
        }
        return out + SENTINEL;
    }
    return truncated ? content + SENTINEL : content;
}
export function preferencesPath() {
    return path.join(vaultPath(), "meta", "preferences.md");
}
export function preferencesCorePath() {
    return path.join(vaultPath(), "meta", "preferences-core.md");
}
// ~250 tokens is enough for the hard-rules core Alfred consumes.
export const PREFERENCES_CORE_MAX_TOKENS = 250;
/**
 * Guard that producer ceiling <= consumer slot. Throws if they drift apart.
 * Called at the top of emitPreferencesCore and exported for tests.
 */
export function validateBudgetConsistency() {
    if (INJECT_LIMITS.prefCore < PREFERENCES_CORE_MAX_TOKENS) {
        throw new Error(`Budget mismatch: INJECT_LIMITS.prefCore (${INJECT_LIMITS.prefCore}) < PREFERENCES_CORE_MAX_TOKENS (${PREFERENCES_CORE_MAX_TOKENS}); the identity core will be silently clipped`);
    }
}
// Imperative first-word prefixes that identify hard rules worth including in
// the lean core file. Matches the same allow-list used across the codebase.
const IMPERATIVE_PREFIXES_CORE = [
    "always", "never", "prefer", "default", "don't", "do not", "avoid", "use",
    "when", "before", "after",
];
function isHardRule(line) {
    const trimmed = line.replace(/^[-*]\s*/, "").trim().toLowerCase();
    return IMPERATIVE_PREFIXES_CORE.some(p => trimmed === p || trimmed.startsWith(p + " ") || trimmed.startsWith(p + ","));
}
/**
 * Extract imperative rules from the universal body, truncate to
 * PREFERENCES_CORE_MAX_TOKENS, and write to meta/preferences-core.md.
 * Called after a successful preference replace write.
 * Pure side-effect: writes the file; throws only on permission errors.
 */
export function emitPreferencesCore(universalBody) {
    validateBudgetConsistency();
    const dest = preferencesCorePath();
    if (!universalBody.trim()) {
        atomicWrite(dest, "");
        return;
    }
    // Extract bullet lines that start with an imperative prefix.
    const coreLines = [];
    for (const raw of universalBody.split("\n")) {
        const line = raw.trim();
        // Skip headings, blank lines, frontmatter remnants, and prose
        if (!line)
            continue;
        if (line.startsWith("#"))
            continue;
        if (line.startsWith("---"))
            continue;
        if (line.startsWith("type:") || line.startsWith("created:") || line.startsWith("updated:") || line.startsWith("superbrain:"))
            continue;
        if (isHardRule(line)) {
            // Strip leading bullet markers for the core file
            coreLines.push(line.replace(/^[-*]\s*/, "- "));
        }
    }
    // Truncate to budget
    const output = [];
    let tokens = 0;
    for (const line of coreLines) {
        const t = estimateTokens(line) + 1; // +1 for newline
        if (tokens + t > PREFERENCES_CORE_MAX_TOKENS)
            break;
        output.push(line);
        tokens += t;
    }
    atomicWrite(dest, output.join("\n") + (output.length > 0 ? "\n" : ""));
}
export function compileInjectionBlock() {
    let raw;
    try {
        raw = fs.readFileSync(preferencesPath(), "utf8");
    }
    catch {
        return "";
    }
    const body = capPreferences(parseNote(raw).content.trim());
    if (!body)
        return "";
    return `--- Your preferences (SuperBrain) ---\n${body}\n-------------------------------------`;
}
