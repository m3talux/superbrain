/**
 * Cross-version store fence (C1).
 *
 * Incident (2026-06-09): a session running a stale pre-0.8 plugin cache
 * resolved its checkpoint hooks against ~/.superbrain/index.db and wrote
 * v0.7-format vectors (raw JSON float arrays into a float[384] vec_chunks)
 * into the v0.8 store, whose vec_chunks is int8[256] — sqlite-vec rejected
 * the writes ("expected int8, but a float32 vector was provided"). Worse,
 * an old writer that adopts the shared file can also insert notes/chunks
 * rows whose content-hashes make reconcile() skip re-embedding: silent
 * poisoning. Old plugin caches are immutable, so the store itself must move
 * out of the old code's reach: 0.8.2+ opens a versioned file (index-v2.db)
 * and leaves legacy index.db on disk untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { openIndex } from "../src/searchIndex.js";
import { reconcile } from "../src/indexer.js";
import { EMBED_DIM } from "../src/embed.js";

let TMP_DATA: string;
let TMP_VAULT: string;

const NOTE_REL = "decisions/alpha.md";
const NOTE_BODY = "---\ntype: decision\n---\n## Decisions\nchose sqlite over postgres for alpha-proj";

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-xver-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-xver-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.mkdirSync(path.join(TMP_VAULT, "decisions"), { recursive: true });
  fs.writeFileSync(path.join(TMP_VAULT, NOTE_REL), NOTE_BODY);
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_VAULT_DIR;
});

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * Reproduce exactly what the immutable v0.7 plugin cache does against the
 * LEGACY path: CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks ... float[384],
 * then a raw JSON-text float insert, plus chunks/notes rows. The notes row
 * carries the CURRENT on-disk content hash — in a shared store this would
 * make reconcile() skip re-embedding (silent poisoning).
 */
function simulateLegacyV07Writer(legacyDbPath: string): void {
  const db = new Database(legacyDbPath);
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (rel_path TEXT PRIMARY KEY, mtime INTEGER, hash TEXT);
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY, rel_path TEXT, heading_path TEXT, anchor TEXT, text TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(chunk_id integer primary key, embedding float[384]);
  `);
  const chunkId = Number(db.prepare(
    "INSERT INTO chunks(rel_path,heading_path,anchor,text) VALUES (?,?,?,?)"
  ).run(NOTE_REL, "Stale", "stale", "stale v0.7 writer content").lastInsertRowid);
  const floatJson = JSON.stringify(Array.from({ length: 384 }, () => 0.05));
  db.prepare("INSERT INTO vec_chunks(chunk_id,embedding) VALUES (?,?)").run(BigInt(chunkId), floatJson);
  // Poison attempt: hash matches the real on-disk note, so a shared-store
  // reconcile() would consider the note up to date and never re-embed it.
  db.prepare("INSERT OR REPLACE INTO notes(rel_path,mtime,hash) VALUES (?,?,?)")
    .run(NOTE_REL, 1, sha(NOTE_BODY));
  db.close();
}

describe("cross-version store fence", () => {
  it("opens a versioned store file (index-v2.db) that old writers never touch", async () => {
    const ix = openIndex();
    ix.close();
    expect(fs.existsSync(path.join(TMP_DATA, "index-v2.db"))).toBe(true);

    // The old writer goes after the legacy path; it must not reach the new store.
    simulateLegacyV07Writer(path.join(TMP_DATA, "index.db"));

    await reconcile();

    const ix2 = openIndex();
    // The vault note is indexed (the poisoned hash in the legacy file did not
    // make reconcile skip it) ...
    expect(ix2.allIndexedPaths()).toContain(NOTE_REL);
    const chunks = ix2.db.prepare("SELECT id, text FROM chunks").all() as { id: number; text: string }[];
    expect(chunks.length).toBeGreaterThan(0);
    // ... no stale v0.7 chunk text leaked into the new store ...
    for (const c of chunks) expect(c.text).not.toContain("stale v0.7 writer content");
    // ... and every chunk has an int8 vector of exactly EMBED_DIM bytes.
    const vecs = ix2.db.prepare("SELECT chunk_id, length(embedding) AS len FROM vec_chunks").all() as { chunk_id: number; len: number }[];
    expect(vecs.length).toBe(chunks.length);
    for (const v of vecs) expect(v.len).toBe(EMBED_DIM);
    ix2.close();
  });

  it("leaves the legacy index.db on disk untouched (no user data deleted, no schema mutation)", async () => {
    // Legacy store exists BEFORE the upgraded code ever runs (migration path).
    simulateLegacyV07Writer(path.join(TMP_DATA, "index.db"));
    const legacyBytesBefore = fs.statSync(path.join(TMP_DATA, "index.db")).size;

    const ix = openIndex();
    ix.close();
    await reconcile();

    // Legacy file still present, still v0.7-shaped (float[384] vec_chunks, raw row intact).
    expect(fs.existsSync(path.join(TMP_DATA, "index.db"))).toBe(true);
    const legacy = new Database(path.join(TMP_DATA, "index.db"));
    sqliteVec.load(legacy);
    const ddl = (legacy.prepare(
      "SELECT sql FROM sqlite_master WHERE name='vec_chunks'"
    ).get() as { sql: string }).sql;
    expect(ddl).toContain("float[384]");
    const legacyVecs = legacy.prepare("SELECT count(*) AS c FROM vec_chunks").get() as { c: number };
    expect(legacyVecs.c).toBe(1);
    legacy.close();
    expect(fs.statSync(path.join(TMP_DATA, "index.db")).size).toBe(legacyBytesBefore);
  });

  it("migration: with a legacy index.db present, a fresh index-v2.db is built and reconcile() indexes every vault note", async () => {
    // More vault notes than the single seeded one.
    fs.mkdirSync(path.join(TMP_VAULT, "projects"), { recursive: true });
    fs.writeFileSync(path.join(TMP_VAULT, "projects/beta-svc.md"),
      "---\ntype: project\nproject: beta-svc\n---\n## Overview\nbeta-svc owns the ingestion pipeline");
    fs.mkdirSync(path.join(TMP_VAULT, "lessons"), { recursive: true });
    fs.writeFileSync(path.join(TMP_VAULT, "lessons/run-full-suite.md"),
      "---\ntype: lesson\n---\n## Rule\nalways run the full suite");

    simulateLegacyV07Writer(path.join(TMP_DATA, "index.db"));

    const ix = openIndex();
    // Fresh store: nothing carried over from the legacy file.
    expect(ix.allIndexedPaths()).toEqual([]);
    ix.close();

    const res = await reconcile();
    expect(res.added).toBe(3);

    const ix2 = openIndex();
    expect(ix2.allIndexedPaths().sort()).toEqual([
      NOTE_REL, "lessons/run-full-suite.md", "projects/beta-svc.md",
    ].sort());
    const vecs = ix2.db.prepare("SELECT length(embedding) AS len FROM vec_chunks").all() as { len: number }[];
    expect(vecs.length).toBeGreaterThanOrEqual(3);
    for (const v of vecs) expect(v.len).toBe(EMBED_DIM);
    ix2.close();
  });
});
