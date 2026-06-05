import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { vaultPath, dataDir } from "./paths.js";
import { chunkNote } from "./chunker.js";
import { embed } from "./embed.js";
import { openIndex } from "./searchIndex.js";
import { parseNote } from "./frontmatter.js";
import { deriveEdges, deleteEdgesFrom, upsertEdges } from "./edges.js";
import { slug as routerSlug } from "./router.js";
const EXCLUDED = new Set([".trash", ".obsidian", ".git", "node_modules"]);
function walk(dir, root, acc) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (EXCLUDED.has(e.name))
                continue;
            walk(path.join(dir, e.name), root, acc);
        }
        else if (e.name.endsWith(".md")) {
            // Vault relpaths are forward-slash-delimited everywhere else
            // (router.ts produces 'decisions/foo.md' etc.); path.relative returns
            // backslashes on Windows, so normalize at this boundary.
            acc.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/"));
        }
    }
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
async function indexInto(ix, relPath) {
    const abs = path.join(vaultPath(), relPath);
    const raw = fs.readFileSync(abs, "utf8");
    const { data: fm } = parseNote(raw);
    const chunks = chunkNote(raw);
    // Always refresh edges (delete old, insert new) regardless of chunk count
    deleteEdgesFrom(ix.db, relPath);
    if (chunks.length === 0) {
        ix.deleteNote(relPath);
        return;
    }
    const embs = await embed(chunks.map((c) => c.text));
    const created = typeof fm.created === "string" ? fm.created
        : fm.created instanceof Date ? fm.created.toISOString()
            : undefined;
    ix.upsertNote(relPath, Math.floor(fs.statSync(abs).mtimeMs), sha(raw), chunks, embs, fm.project, created);
    upsertEdges(ix.db, deriveEdges(relPath, fm));
}
export async function indexNote(relPath) {
    const ix = openIndex();
    try {
        await indexInto(ix, relPath);
    }
    finally {
        ix.close();
    }
}
export async function reindexAll() {
    const root = vaultPath();
    const ix = openIndex();
    let reindexed = 0;
    try {
        if (!fs.existsSync(root))
            return { reindexed };
        const present = [];
        walk(root, root, present);
        for (const rel of present) {
            await indexInto(ix, rel);
            reindexed++;
        }
        return { reindexed };
    }
    finally {
        ix.close();
    }
}
/**
 * Run backfillProjectNulls exactly once, guarded by a sentinel file so
 * no legit note disappears during the transition window before all notes
 * have a project assigned.
 *
 * Ships atomically with the fail-closed isCrossProject filter in recall.ts.
 */
export async function runBackfillIfNeeded(dir) {
    const base = dir ?? dataDir();
    const sentinelFile = path.join(base, "v1-project-backfill.txt");
    if (fs.existsSync(sentinelFile))
        return false;
    await backfillProjectNulls();
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(sentinelFile, new Date().toISOString() + "\n", "utf8");
    return true;
}
export async function forcedReindexIfNeeded(version, dir) {
    const base = dir ?? dataDir();
    const sentinelFile = path.join(base, `reindexed-${version}.txt`);
    if (fs.existsSync(sentinelFile))
        return false;
    await reindexAll();
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(sentinelFile, new Date().toISOString() + "\n", "utf8");
    return true;
}
/**
 * Backfill the `project` column for all notes that currently have NULL.
 * Rules (in priority order):
 *  1. If the note file has a non-empty `project` field in frontmatter, use slug(fm.project).
 *  2. If the path matches `projects/<slug>.md`, use <slug>.
 *  3. Standard cross-cutting folders (daily/, decisions/, lessons/, knowledge/, meta/) -> "global".
 *  4. Everything else -> "global" (safe default).
 *
 * Ships atomically with the fail-closed isCrossProject filter via the
 * 'v1-project-backfill' version sentinel so no note vanishes mid-change.
 */
export async function backfillProjectNulls() {
    const root = vaultPath();
    const ix = openIndex();
    let repaired = 0;
    try {
        const rows = ix.db.prepare("SELECT rel_path FROM notes WHERE project IS NULL").all();
        for (const row of rows) {
            const relPath = row.rel_path;
            let project = "global";
            try {
                const abs = path.join(root, relPath);
                if (fs.existsSync(abs)) {
                    const raw = fs.readFileSync(abs, "utf8");
                    const { data: fm } = parseNote(raw);
                    if (fm.project && typeof fm.project === "string" && fm.project.trim()) {
                        project = routerSlug(fm.project);
                    }
                    else {
                        // Derive from path
                        const parts = relPath.split("/");
                        if (parts[0] === "projects" && parts.length === 2) {
                            // projects/<slug>.md
                            project = parts[1].replace(/\.md$/, "");
                        }
                        else if (parts[0] === "daily" ||
                            parts[0] === "decisions" ||
                            parts[0] === "lessons" ||
                            parts[0] === "knowledge" ||
                            parts[0] === "meta") {
                            project = "global";
                        }
                        else {
                            project = "global";
                        }
                    }
                }
            }
            catch {
                project = "global";
            }
            ix.db.prepare("UPDATE notes SET project = ? WHERE rel_path = ?").run(project, relPath);
            repaired++;
        }
        return { repaired };
    }
    finally {
        ix.close();
    }
}
export async function reconcile() {
    const root = vaultPath();
    const ix = openIndex();
    const res = { added: 0, updated: 0, deleted: 0 };
    try {
        if (!fs.existsSync(root))
            return res;
        const present = [];
        walk(root, root, present);
        const presentSet = new Set(present);
        for (const rel of present) {
            const raw = fs.readFileSync(path.join(root, rel), "utf8");
            const meta = ix.getNoteMeta(rel);
            const h = sha(raw);
            if (!meta) {
                await indexInto(ix, rel);
                res.added++;
            }
            else if (meta.hash !== h) {
                await indexInto(ix, rel);
                res.updated++;
            }
        }
        for (const rel of ix.allIndexedPaths())
            if (!presentSet.has(rel)) {
                ix.deleteNote(rel);
                res.deleted++;
            }
        return res;
    }
    finally {
        ix.close();
    }
}
