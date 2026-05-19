import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { serializeNote, parseNote, validateFrontmatter } from "./frontmatter.js";
import { atomicWrite, readWithChecksum } from "./atomicWrite.js";
const ALLOWED_EXT = new Set([".md"]);
const EXCLUDED = ["/.obsidian/", "/.git/", "/node_modules/", "/.trash/"];
function resolveSafe(rel) {
    const root = path.resolve(vaultPath());
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep))
        return null;
    if (!ALLOWED_EXT.has(path.extname(abs)))
        return null;
    if (EXCLUDED.some((e) => (abs + "/").includes(e)))
        return null;
    return abs;
}
const normBody = (s) => s.replace(/\s+/g, " ").trim();
export function writeNote(rel, args) {
    const abs = resolveSafe(rel);
    if (!abs)
        return { ok: false, reason: "path or extension not allowed" };
    const errs = validateFrontmatter(args.frontmatter);
    if (errs.length)
        return { ok: false, reason: errs.join("; ") };
    if (args.mode === "replace") {
        const cur = readWithChecksum(abs);
        if (cur) {
            const prev = parseNote(cur.content);
            if (normBody(prev.content) === normBody(args.body))
                return { ok: true, path: abs };
            const created = prev.data.created ?? args.frontmatter.created;
            const fm = created === undefined ? { ...args.frontmatter } : { ...args.frontmatter, created };
            atomicWrite(abs, serializeNote(fm, args.body));
            return { ok: true, path: abs };
        }
        atomicWrite(abs, serializeNote(args.frontmatter, args.body));
        return { ok: true, path: abs };
    }
    const existing = readWithChecksum(abs);
    if (!existing) {
        atomicWrite(abs, serializeNote(args.frontmatter, args.body));
        return { ok: true, path: abs };
    }
    // Existing file: never blind-overwrite. Append distilled body under a dated section.
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const parsed = parseNote(existing.content);
    const mergedFm = { ...parsed.data, ...args.frontmatter, updated: stamp.slice(0, 10) };
    const appended = `${parsed.content.replace(/\s+$/, "")}\n\n## ${stamp}\n\n${args.body}\n`;
    atomicWrite(abs, serializeNote(mergedFm, appended));
    return { ok: true, path: abs };
}
export function softDelete(rel) {
    const abs = resolveSafe(rel);
    if (!abs || !fs.existsSync(abs))
        return { ok: false, reason: "not found" };
    const trash = path.join(path.resolve(vaultPath()), ".trash");
    fs.mkdirSync(trash, { recursive: true });
    const dest = path.join(trash, `${Date.now()}-${path.basename(abs)}`);
    fs.renameSync(abs, dest);
    return { ok: true, path: dest };
}
