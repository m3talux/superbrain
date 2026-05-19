import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { dataDir } from "./paths.js";
import { EMBED_DIM } from "./embed.js";

export interface Hit { relPath: string; headingPath: string; anchor: string; text: string; }

export interface Index {
  upsertNote(relPath: string, mtime: number, hash: string,
             chunks: { headingPath: string; anchor: string; text: string }[],
             embeddings: Float32Array[]): void;
  deleteNote(relPath: string): void;
  bm25(query: string, k: number): Hit[];
  vectorKNN(v: Float32Array, k: number): Hit[];
  getNoteMeta(relPath: string): { mtime: number; hash: string } | null;
  allIndexedPaths(): string[];
  close(): void;
}

export function rrf(lists: string[][], k: number, c = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists)
    list.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (c + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
}

export function openIndex(): Index {
  const dbPath = path.join(dataDir(), "index.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (rel_path TEXT PRIMARY KEY, mtime INTEGER, hash TEXT);
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY, rel_path TEXT, heading_path TEXT, anchor TEXT, text TEXT);
    CREATE INDEX IF NOT EXISTS chunks_rel ON chunks(rel_path);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='');
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      chunk_id integer primary key, embedding float[${EMBED_DIM}]);
  `);

  const delByPath = db.transaction((relPath: string) => {
    const rows = db.prepare("SELECT id, heading_path, text FROM chunks WHERE rel_path=?").all(relPath) as { id: number; heading_path: string; text: string }[];
    for (const r of rows) {
      db.prepare("INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', ?, ?)").run(r.id, (r.heading_path ? r.heading_path + " " : "") + r.text);
      db.prepare("DELETE FROM vec_chunks WHERE chunk_id=?").run(BigInt(r.id));
    }
    db.prepare("DELETE FROM chunks WHERE rel_path=?").run(relPath);
    db.prepare("DELETE FROM notes WHERE rel_path=?").run(relPath);
  });

  const insChunk = db.prepare("INSERT INTO chunks(rel_path,heading_path,anchor,text) VALUES (?,?,?,?)");
  const insFts = db.prepare("INSERT INTO chunks_fts(rowid,text) VALUES (?,?)");
  const insVec = db.prepare("INSERT INTO vec_chunks(chunk_id,embedding) VALUES (?,?)");
  const insNote = db.prepare("INSERT OR REPLACE INTO notes(rel_path,mtime,hash) VALUES (?,?,?)");

  const upsert = db.transaction((relPath: string, mtime: number, hash: string,
      chunks: { headingPath: string; anchor: string; text: string }[], embs: Float32Array[]) => {
    delByPath(relPath);
    chunks.forEach((c, i) => {
      const id = Number(insChunk.run(relPath, c.headingPath, c.anchor, c.text).lastInsertRowid);
      insFts.run(id, (c.headingPath ? c.headingPath + " " : "") + c.text);
      insVec.run(BigInt(id), JSON.stringify(Array.from(embs[i])));
    });
    insNote.run(relPath, mtime, hash);
  });

  const hydrate = (ids: number[]): Hit[] => ids.map((id) => {
    const r = db.prepare("SELECT rel_path,heading_path,anchor,text FROM chunks WHERE id=?").get(id) as any;
    return r ? { relPath: r.rel_path, headingPath: r.heading_path, anchor: r.anchor, text: r.text } : null;
  }).filter(Boolean) as Hit[];

  return {
    upsertNote: (rp, mt, h, c, e) => upsert(rp, mt, h, c, e),
    deleteNote: (rp) => delByPath(rp),
    bm25: (q, k) => {
      const terms = q.replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean);
      const ftsQuery = terms.length ? terms.join(" OR ") : '""';
      const rows = db.prepare(
        "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?"
      ).all(ftsQuery, k) as { rowid: number }[];
      return hydrate(rows.map((r) => r.rowid));
    },
    vectorKNN: (v, k) => {
      const rows = db.prepare(
        "SELECT chunk_id FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?"
      ).all(JSON.stringify(Array.from(v)), k) as { chunk_id: number }[];
      return hydrate(rows.map((r) => Number(r.chunk_id)));
    },
    getNoteMeta: (rp) => {
      const r = db.prepare("SELECT mtime,hash FROM notes WHERE rel_path=?").get(rp) as any;
      return r ? { mtime: r.mtime, hash: r.hash } : null;
    },
    allIndexedPaths: () =>
      (db.prepare("SELECT rel_path FROM notes ORDER BY rel_path").all() as any[]).map((r) => r.rel_path),
    close: () => db.close(),
  };
}
