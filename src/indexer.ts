import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { vaultPath } from "./paths.js";
import { chunkNote } from "./chunker.js";
import { embed } from "./embed.js";
import { openIndex } from "./searchIndex.js";
import { parseNote } from "./frontmatter.js";
import { deriveEdges, deleteEdgesFrom, upsertEdges } from "./edges.js";

const EXCLUDED = new Set([".trash", ".obsidian", ".git", "node_modules"]);

function walk(dir: string, root: string, acc: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (EXCLUDED.has(e.name)) continue;
      walk(path.join(dir, e.name), root, acc);
    } else if (e.name.endsWith(".md")) {
      // Vault relpaths are forward-slash-delimited everywhere else
      // (router.ts produces 'decisions/foo.md' etc.); path.relative returns
      // backslashes on Windows, so normalize at this boundary.
      acc.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/"));
    }
  }
}
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function indexInto(ix: ReturnType<typeof openIndex>, relPath: string) {
  const abs = path.join(vaultPath(), relPath);
  const raw = fs.readFileSync(abs, "utf8");
  const { data: fm } = parseNote(raw);
  const chunks = chunkNote(raw);
  // Always refresh edges (delete old, insert new) regardless of chunk count
  deleteEdgesFrom(ix.db, relPath);
  if (chunks.length === 0) { ix.deleteNote(relPath); return; }
  const embs = await embed(chunks.map((c) => c.text));
  ix.upsertNote(relPath, Math.floor(fs.statSync(abs).mtimeMs), sha(raw), chunks, embs);
  upsertEdges(ix.db, deriveEdges(relPath, fm));
}

export async function indexNote(relPath: string): Promise<void> {
  const ix = openIndex();
  try { await indexInto(ix, relPath); } finally { ix.close(); }
}

export async function reconcile(): Promise<{ added: number; updated: number; deleted: number }> {
  const root = vaultPath();
  const ix = openIndex();
  const res = { added: 0, updated: 0, deleted: 0 };
  try {
    if (!fs.existsSync(root)) return res;
    const present: string[] = [];
    walk(root, root, present);
    const presentSet = new Set(present);
    for (const rel of present) {
      const raw = fs.readFileSync(path.join(root, rel), "utf8");
      const meta = ix.getNoteMeta(rel);
      const h = sha(raw);
      if (!meta) { await indexInto(ix, rel); res.added++; }
      else if (meta.hash !== h) { await indexInto(ix, rel); res.updated++; }
    }
    for (const rel of ix.allIndexedPaths())
      if (!presentSet.has(rel)) { ix.deleteNote(rel); res.deleted++; }
    return res;
  } finally { ix.close(); }
}
