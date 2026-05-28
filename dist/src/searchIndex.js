import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { dataDir } from "./paths.js";
import { EMBED_DIM } from "./embed.js";
import { ensureEdgesTable } from "./edges.js";
function toScalarString(v) {
    if (typeof v === "string")
        return v;
    if (Array.isArray(v)) {
        const flat = v.flat(Infinity);
        const first = flat.find((x) => typeof x === "string");
        return typeof first === "string" ? first : null;
    }
    if (v instanceof Date)
        return v.toISOString().slice(0, 10);
    return null;
}
export function rrf(lists, k, c = 60) {
    return rrfWithScores(lists, k, c).map((e) => e.id);
}
export function rrfWithScores(lists, k, c = 60) {
    const score = new Map();
    for (const list of lists)
        list.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (c + i + 1)));
    return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id, s]) => ({ id, score: s }));
}
export function openIndex() {
    const dbPath = path.join(dataDir(), "index.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    sqliteVec.load(db);
    db.pragma("journal_mode = WAL");
    db.exec(`
    CREATE TABLE IF NOT EXISTS notes (rel_path TEXT PRIMARY KEY, mtime INTEGER, hash TEXT, project TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY, rel_path TEXT, heading_path TEXT, anchor TEXT, text TEXT);
    CREATE INDEX IF NOT EXISTS chunks_rel ON chunks(rel_path);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='');
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      chunk_id integer primary key, embedding float[${EMBED_DIM}]);
  `);
    // Migrate: add columns if they don't exist (idempotent)
    const cols = db.pragma("table_info(notes)").map((c) => c.name);
    if (!cols.includes("project")) {
        db.exec("ALTER TABLE notes ADD COLUMN project TEXT");
    }
    if (!cols.includes("created")) {
        db.exec("ALTER TABLE notes ADD COLUMN created TEXT");
    }
    ensureEdgesTable(db);
    const delByPath = db.transaction((relPath) => {
        const rows = db.prepare("SELECT id, heading_path, text FROM chunks WHERE rel_path=?").all(relPath);
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
    const insNote = db.prepare("INSERT OR REPLACE INTO notes(rel_path,mtime,hash,project,created) VALUES (?,?,?,?,?)");
    const upsert = db.transaction((relPath, mtime, hash, chunks, embs, project, created) => {
        delByPath(relPath);
        chunks.forEach((c, i) => {
            const id = Number(insChunk.run(relPath, c.headingPath, c.anchor, c.text).lastInsertRowid);
            insFts.run(id, (c.headingPath ? c.headingPath + " " : "") + c.text);
            insVec.run(BigInt(id), JSON.stringify(Array.from(embs[i])));
        });
        insNote.run(relPath, mtime, hash, toScalarString(project ?? null), toScalarString(created ?? null));
    });
    const hydrate = (ids) => ids.map((id) => {
        const r = db.prepare("SELECT rel_path,heading_path,anchor,text FROM chunks WHERE id=?").get(id);
        return r ? { relPath: r.rel_path, headingPath: r.heading_path, anchor: r.anchor, text: r.text } : null;
    }).filter(Boolean);
    return {
        db,
        upsertNote: (rp, mt, h, c, e, project, created) => upsert(rp, mt, h, c, e, project, created),
        deleteNote: (rp) => delByPath(rp),
        bm25: (q, k) => {
            const terms = q.replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean);
            const ftsQuery = terms.length ? terms.join(" OR ") : '""';
            const rows = db.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?").all(ftsQuery, k);
            return hydrate(rows.map((r) => r.rowid));
        },
        vectorKNN: (v, k) => {
            const rows = db.prepare("SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?").all(JSON.stringify(Array.from(v)), k);
            const hits = hydrate(rows.map((r) => Number(r.chunk_id)));
            hits.forEach((h, i) => { h.distance = rows[i]?.distance; });
            return hits;
        },
        getProjectsForPaths: (relPaths) => {
            if (relPaths.length === 0)
                return new Map();
            const placeholders = relPaths.map(() => "?").join(",");
            const rows = db.prepare(`SELECT rel_path, project FROM notes WHERE rel_path IN (${placeholders}) AND project IS NOT NULL`).all(...relPaths);
            return new Map(rows.map((r) => [r.rel_path, r.project]));
        },
        getCreatedForPaths: (relPaths) => {
            if (relPaths.length === 0)
                return new Map();
            const placeholders = relPaths.map(() => "?").join(",");
            const rows = db.prepare(`SELECT rel_path, created FROM notes WHERE rel_path IN (${placeholders}) AND created IS NOT NULL`).all(...relPaths);
            return new Map(rows.map((r) => [r.rel_path, r.created]));
        },
        getNoteMeta: (rp) => {
            const r = db.prepare("SELECT mtime,hash FROM notes WHERE rel_path=?").get(rp);
            return r ? { mtime: r.mtime, hash: r.hash } : null;
        },
        allIndexedPaths: () => db.prepare("SELECT rel_path FROM notes ORDER BY rel_path").all().map((r) => r.rel_path),
        close: () => db.close(),
    };
}
