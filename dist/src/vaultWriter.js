import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { serializeNote, parseNote, validateFrontmatter } from "./frontmatter.js";
import { atomicWrite, readWithChecksum, casWrite } from "./atomicWrite.js";
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
    const relNorm = rel.replace(/\\/g, "/");
    if (relNorm.startsWith("projects/") && !relNorm.startsWith("projects/_archive/")) {
        const stamp = new Date().toISOString().slice(0, 10);
        const date = args.frontmatter.created || stamp;
        try {
            let archived = [];
            let dedupHit = false;
            casWrite(abs, (currentRaw) => {
                let currentBody;
                let baseFm;
                if (currentRaw) {
                    const parsed = parseNote(currentRaw);
                    const newNorm = normBody(args.body);
                    if (newNorm.length >= 40 && normBody(parsed.content).includes(newNorm)) {
                        dedupHit = true;
                        return currentRaw;
                    }
                    currentBody = parsed.content;
                    baseFm = parsed.data;
                }
                else {
                    const slug = path.basename(abs, ".md");
                    currentBody = initializeProjectNote(slug, args.frontmatter);
                    baseFm = {};
                }
                if (!currentBody.includes("\n## Recent activity\n") &&
                    !currentBody.endsWith("## Recent activity") &&
                    !currentBody.startsWith("## Recent activity\n")) {
                    currentBody = currentBody.replace(/\s+$/, "") + "\n\n## Recent activity\n";
                }
                const mergedFm = { ...baseFm, ...args.frontmatter, updated: stamp };
                const fmOverhead = Buffer.byteLength(serializeNote(mergedFm, ""), "utf8");
                const r = appendDatedSectionWithArchive(currentBody, date, args.body, {
                    sizeCap: Math.max(8192, (Number(process.env.SUPERBRAIN_PROJECT_NOTE_CAP_BYTES) || 32 * 1024) - fmOverhead),
                });
                archived = r.archived;
                return serializeNote(mergedFm, r.body);
            });
            if (dedupHit)
                return { ok: true, path: abs, reason: "duplicate-skipped" };
            for (const a of archived) {
                const year = a.date === "0000-00-00"
                    ? new Date().toISOString().slice(0, 4)
                    : a.date.slice(0, 4);
                const month = a.date === "0000-00-00"
                    ? new Date().getMonth() + 1
                    : parseInt(a.date.slice(5, 7), 10);
                const q = Math.ceil(month / 3);
                const slug = path.basename(abs, ".md");
                const archivePath = path.join(path.resolve(vaultPath()), "projects", "_archive", `${slug}-${year}-Q${q}.md`);
                fs.mkdirSync(path.dirname(archivePath), { recursive: true });
                if (!fs.existsSync(archivePath)) {
                    const afm = serializeNote({ type: "summary", project: slug, archived_from: `projects/${slug}.md` }, `# ${slug} - archive ${year} Q${q}\n`);
                    fs.writeFileSync(archivePath, afm);
                }
                const archiveBlock = `\n### ${a.date}\n\n${a.content}\n`;
                fs.appendFileSync(archivePath, archiveBlock);
            }
            return { ok: true, path: abs };
        }
        catch (_e) {
            if (!existing) {
                atomicWrite(abs, serializeNote(args.frontmatter, args.body));
                return { ok: true, path: abs };
            }
            casWrite(abs, (currentRaw) => {
                const stamp2 = new Date().toISOString().slice(0, 16).replace("T", " ");
                const parsed = parseNote(currentRaw ?? "");
                const mergedFm = { ...parsed.data, ...args.frontmatter, updated: stamp2.slice(0, 10) };
                return serializeNote(mergedFm, `${parsed.content.replace(/\s+$/, "")}\n\n## ${stamp2}\n\n${args.body}\n`);
            });
            return { ok: true, path: abs };
        }
    }
    if (!existing) {
        atomicWrite(abs, serializeNote(args.frontmatter, args.body));
        return { ok: true, path: abs };
    }
    let dedupHit = false;
    casWrite(abs, (currentRaw) => {
        const parsed = parseNote(currentRaw ?? "");
        const newNorm = normBody(args.body);
        if (newNorm.length >= 40 && normBody(parsed.content).includes(newNorm)) {
            dedupHit = true;
            return currentRaw ?? "";
        }
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        const mergedFm = { ...parsed.data, ...args.frontmatter, updated: stamp.slice(0, 10) };
        return serializeNote(mergedFm, `${parsed.content.replace(/\s+$/, "")}\n\n## ${stamp}\n\n${args.body}\n`);
    });
    if (dedupHit)
        return { ok: true, path: abs, reason: "duplicate-skipped" };
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
