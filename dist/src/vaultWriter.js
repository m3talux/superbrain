import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { serializeNote, parseNote, validateFrontmatter } from "./frontmatter.js";
import { atomicWrite, readWithChecksum } from "./atomicWrite.js";
import { appendDatedSectionWithArchive, initializeProjectNote } from "./projectWriter.js";
const ALLOWED_EXT = new Set([".md"]);
const EXCLUDED = ["/.obsidian/", "/.git/", "/node_modules/", "/.trash/"];
function resolveSafe(rel) {
    const root = path.resolve(vaultPath());
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep))
        return null;
    if (!ALLOWED_EXT.has(path.extname(abs)))
        return null;
    const normalized = abs.replace(/\\/g, "/");
    if (EXCLUDED.some((e) => (normalized + "/").includes(e)))
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
    // Project notes (projects/<slug>.md) get structured dated subsections under
    // "## Recent activity" with auto-archiving when the file exceeds 20 KB.
    const relNorm = rel.replace(/\\/g, "/");
    if (relNorm.startsWith("projects/") && !relNorm.startsWith("projects/_archive/")) {
        const stamp = new Date().toISOString().slice(0, 10);
        const date = args.frontmatter.created || stamp;
        try {
            // Determine current body (content portion only, no frontmatter)
            let currentBody;
            let baseFm;
            if (existing) {
                const parsed = parseNote(existing.content);
                // Dedup: skip if the normalized new body already appears in the file.
                const newNorm = normBody(args.body);
                if (newNorm.length >= 40 && normBody(parsed.content).includes(newNorm)) {
                    return { ok: true, path: abs, reason: "duplicate-skipped" };
                }
                currentBody = parsed.content;
                baseFm = parsed.data;
            }
            else {
                const slug = path.basename(abs, ".md");
                currentBody = initializeProjectNote(slug, args.frontmatter);
                baseFm = {};
            }
            // Backfill ## Recent activity if the note pre-dates this feature
            if (!currentBody.includes("\n## Recent activity\n") &&
                !currentBody.endsWith("## Recent activity") &&
                !currentBody.startsWith("## Recent activity\n")) {
                currentBody = currentBody.replace(/\s+$/, "") + "\n\n## Recent activity\n";
            }
            const r = appendDatedSectionWithArchive(currentBody, date, args.body);
            const mergedFm = { ...baseFm, ...args.frontmatter, updated: stamp };
            atomicWrite(abs, serializeNote(mergedFm, r.body));
            // Persist archived sections to projects/_archive/<slug>-<year>-Q<n>.md
            for (const a of r.archived) {
                const year = a.date.slice(0, 4);
                const month = parseInt(a.date.slice(5, 7), 10);
                const q = Math.ceil(month / 3);
                const slug = path.basename(abs, ".md");
                const archivePath = path.join(path.resolve(vaultPath()), "projects", "_archive", `${slug}-${year}-Q${q}.md`);
                fs.mkdirSync(path.dirname(archivePath), { recursive: true });
                const archiveBlock = `\n### ${a.date}\n\n${a.content}\n`;
                fs.appendFileSync(archivePath, archiveBlock);
            }
            return { ok: true, path: abs };
        }
        catch (_e) {
            // Fail open: fall back to legacy plain append so the distiller never crashes
            if (!existing) {
                atomicWrite(abs, serializeNote(args.frontmatter, args.body));
                return { ok: true, path: abs };
            }
            const stamp2 = new Date().toISOString().slice(0, 16).replace("T", " ");
            const parsed = parseNote(existing.content);
            const mergedFm = { ...parsed.data, ...args.frontmatter, updated: stamp2.slice(0, 10) };
            const appended = `${parsed.content.replace(/\s+$/, "")}\n\n## ${stamp2}\n\n${args.body}\n`;
            atomicWrite(abs, serializeNote(mergedFm, appended));
            return { ok: true, path: abs };
        }
    }
    if (!existing) {
        atomicWrite(abs, serializeNote(args.frontmatter, args.body));
        return { ok: true, path: abs };
    }
    // Existing file: never blind-overwrite. Append distilled body under a dated section.
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const parsed = parseNote(existing.content);
    // Dedup: the distiller can re-emit the same project_fact / gotcha across
    // adjacent runs (the model has no memory of prior emissions). Skip the
    // append if the normalized new body already appears in the file. The 40-
    // char floor avoids false positives on generic phrasing.
    const newNorm = normBody(args.body);
    if (newNorm.length >= 40 && normBody(parsed.content).includes(newNorm)) {
        return { ok: true, path: abs, reason: "duplicate-skipped" };
    }
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
