import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { dataDir } from "./paths.js";
import { EMBED_DIM, MODEL_ID } from "./embed.js";
import { ensureEdgesTable } from "./edges.js";
import { quantizeToInt8, serializeInt8ForSql } from "./staticEmbed/int8Quant.js";

function clearReindexSentinels(dir: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith("reindexed-") && f.endsWith(".txt")) {
        fs.rmSync(path.join(dir, f), { force: true });
      }
    }
  } catch { /* dir may not exist yet */ }
}

const CHUNK_CAP = 50;

export interface Hit { relPath: string; headingPath: string; anchor: string; text: string; distance?: number; }

function toScalarString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const flat = (v as unknown[]).flat(Infinity);
    const first = flat.find((x) => typeof x === "string");
    return typeof first === "string" ? first : null;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

export interface Index {
  db: Database.Database;
  upsertNote(relPath: string, mtime: number, hash: string,
             chunks: { headingPath: string; anchor: string; text: string }[],
             embeddings: Float32Array[],
             project?: unknown,
             created?: unknown): void;
  deleteNote(relPath: string): void;
  bm25(query: string, k: number): Hit[];
  vectorKNN(v: Float32Array, k: number): Hit[];
  /** BM25 restricted to global/daily/preference notes only. */
  bm25Global(query: string, k: number): Hit[];
  /** vectorKNN restricted to global/daily/preference notes only. */
  vectorKNNGlobal(v: Float32Array, k: number): Hit[];
  /** Fallback: return up to k global/daily/pref notes ordered by created date desc. */
  globalFallbackNotes(k: number): Hit[];
  getNoteMeta(relPath: string): { mtime: number; hash: string } | null;
  getProjectsForPaths(relPaths: string[]): Map<string, string>;
  getCreatedForPaths(relPaths: string[]): Map<string, string>;
  allIndexedPaths(): string[];
  close(): void;
}

export function rrf(lists: string[][], k: number, c = 60): string[] {
  return rrfWithScores(lists, k, c).map((e) => e.id);
}

export function rrfWithScores(lists: string[][], k: number, c = 60): { id: string; score: number }[] {
  const score = new Map<string, number>();
  for (const list of lists)
    list.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (c + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id, s]) => ({ id, score: s }));
}

function ensureVecTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS embed_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS notes (rel_path TEXT PRIMARY KEY, mtime INTEGER, hash TEXT, project TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY, rel_path TEXT, heading_path TEXT, anchor TEXT, text TEXT);
    CREATE INDEX IF NOT EXISTS chunks_rel ON chunks(rel_path);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='');
  `);

  const storedDim = (db.prepare("SELECT value FROM embed_meta WHERE key='dim'").get() as { value: string } | undefined)?.value;
  const storedModel = (db.prepare("SELECT value FROM embed_meta WHERE key='model_id'").get() as { value: string } | undefined)?.value;
  const dimMatch = storedDim === String(EMBED_DIM);
  const modelMatch = storedModel === MODEL_ID;

  const vecExists = !!(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='vec_chunks'").get());

  if (!vecExists || !dimMatch || !modelMatch) {
    if (vecExists) db.exec("DROP TABLE vec_chunks");
    db.exec(`CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id integer primary key, embedding int8[${EMBED_DIM}])`);
    db.exec("DELETE FROM embed_meta WHERE key IN ('dim','model_id')");
    db.prepare("INSERT INTO embed_meta(key,value) VALUES ('dim',?)").run(String(EMBED_DIM));
    db.prepare("INSERT INTO embed_meta(key,value) VALUES ('model_id',?)").run(MODEL_ID);
    if (vecExists) {
      // Existing chunks lost their vectors. Invalidate version sentinels so
      // forcedReindexIfNeeded runs reindexAll() on the next session start.
      clearReindexSentinels(dataDir());
    }
  }
}

export function openIndex(): Index {
  const dbPath = path.join(dataDir(), "index.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");

  ensureVecTable(db);

  // Migrate: add columns if they don't exist (idempotent)
  const cols = (db.pragma("table_info(notes)") as { name: string }[]).map((c) => c.name);
  if (!cols.includes("project")) db.exec("ALTER TABLE notes ADD COLUMN project TEXT");
  if (!cols.includes("created")) db.exec("ALTER TABLE notes ADD COLUMN created TEXT");
  ensureEdgesTable(db);

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
  const insVec = db.prepare("INSERT INTO vec_chunks(chunk_id,embedding) VALUES (?,vec_int8(?))");
  const insNote = db.prepare("INSERT OR REPLACE INTO notes(rel_path,mtime,hash,project,created) VALUES (?,?,?,?,?)");

  const upsert = db.transaction((relPath: string, mtime: number, hash: string,
      chunks: { headingPath: string; anchor: string; text: string }[], embs: Float32Array[],
      project?: unknown, created?: unknown) => {
    delByPath(relPath);
    const capped = chunks.slice(0, CHUNK_CAP);
    capped.forEach((c, i) => {
      const id = Number(insChunk.run(relPath, c.headingPath, c.anchor, c.text).lastInsertRowid);
      insFts.run(id, (c.headingPath ? c.headingPath + " " : "") + c.text);
      insVec.run(BigInt(id), serializeInt8ForSql(quantizeToInt8(embs[i])));
    });
    insNote.run(relPath, mtime, hash, toScalarString(project ?? null), toScalarString(created ?? null));
  });

  const hydrate = (ids: number[]): Hit[] => ids.map((id) => {
    const r = db.prepare("SELECT rel_path,heading_path,anchor,text FROM chunks WHERE id=?").get(id) as any;
    return r ? { relPath: r.rel_path, headingPath: r.heading_path, anchor: r.anchor, text: r.text } : null;
  }).filter(Boolean) as Hit[];

  return {
    db,
    upsertNote: (rp: string, mt: number, h: string, c: { headingPath: string; anchor: string; text: string }[], e: Float32Array[], project?: unknown, created?: unknown) => upsert(rp, mt, h, c, e, project, created),
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
        "SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH vec_int8(?) ORDER BY distance LIMIT ?"
      ).all(serializeInt8ForSql(quantizeToInt8(v)), k) as { chunk_id: number; distance: number }[];
      const hits = hydrate(rows.map((r) => Number(r.chunk_id)));
      hits.forEach((h, i) => { h.distance = rows[i]?.distance; });
      return hits;
    },
    bm25Global: (q, k) => {
      // Fetch a wider BM25 set and filter down to global/daily/pref notes.
      const terms = q.replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean);
      const ftsQuery = terms.length ? terms.join(" OR ") : '""';
      const rows = db.prepare(
        "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?"
      ).all(ftsQuery, k * 4) as { rowid: number }[];
      const filtered: number[] = [];
      for (const row of rows) {
        if (filtered.length >= k) break;
        const chunk = db.prepare("SELECT rel_path FROM chunks WHERE id=?").get(row.rowid) as { rel_path: string } | undefined;
        if (!chunk) continue;
        const note = db.prepare("SELECT project FROM notes WHERE rel_path=?").get(chunk.rel_path) as { project: string | null } | undefined;
        if (!note) continue;
        if (
          note.project === "global" ||
          chunk.rel_path.startsWith("daily/") ||
          chunk.rel_path === "meta/preferences.md"
        ) {
          filtered.push(row.rowid);
        }
      }
      return hydrate(filtered);
    },
    vectorKNNGlobal: (v, k) => {
      // Fetch a wider candidate set from vectorKNN, then filter to global/daily/pref.
      const allRows = db.prepare(
        "SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH vec_int8(?) ORDER BY distance LIMIT ?"
      ).all(serializeInt8ForSql(quantizeToInt8(v)), k * 4) as { chunk_id: number; distance: number }[];
      // Filter by joining with notes for global/daily/pref restriction
      const filtered: { chunk_id: number; distance: number }[] = [];
      for (const row of allRows) {
        if (filtered.length >= k) break;
        const chunk = db.prepare("SELECT rel_path FROM chunks WHERE id=?").get(Number(row.chunk_id)) as { rel_path: string } | undefined;
        if (!chunk) continue;
        const note = db.prepare("SELECT project FROM notes WHERE rel_path=?").get(chunk.rel_path) as { project: string | null } | undefined;
        if (!note) continue;
        if (
          note.project === "global" ||
          chunk.rel_path.startsWith("daily/") ||
          chunk.rel_path === "meta/preferences.md"
        ) {
          filtered.push(row);
        }
      }
      const hits = hydrate(filtered.map((r) => Number(r.chunk_id)));
      hits.forEach((h, i) => { h.distance = filtered[i]?.distance; });
      return hits;
    },
    globalFallbackNotes: (k) => {
      // Return chunks from global/daily/pref notes ordered by created date desc.
      const rows = db.prepare(`
        SELECT c.id FROM chunks c
        JOIN notes n ON n.rel_path = c.rel_path
        WHERE (
          n.project = 'global'
          OR n.rel_path LIKE 'daily/%'
          OR n.rel_path = 'meta/preferences.md'
        )
        ORDER BY n.created DESC, c.id DESC
        LIMIT ?
      `).all(k) as { id: number }[];
      return hydrate(rows.map((r) => r.id));
    },
    getProjectsForPaths: (relPaths: string[]): Map<string, string> => {
      if (relPaths.length === 0) return new Map();
      const placeholders = relPaths.map(() => "?").join(",");
      const rows = db.prepare(
        `SELECT rel_path, project FROM notes WHERE rel_path IN (${placeholders}) AND project IS NOT NULL`
      ).all(...relPaths) as { rel_path: string; project: string }[];
      return new Map(rows.map((r) => [r.rel_path, r.project]));
    },
    getCreatedForPaths: (relPaths: string[]): Map<string, string> => {
      if (relPaths.length === 0) return new Map();
      const placeholders = relPaths.map(() => "?").join(",");
      const rows = db.prepare(
        `SELECT rel_path, created FROM notes WHERE rel_path IN (${placeholders}) AND created IS NOT NULL`
      ).all(...relPaths) as { rel_path: string; created: string }[];
      return new Map(rows.map((r) => [r.rel_path, r.created]));
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
