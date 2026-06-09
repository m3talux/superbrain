/**
 * Regression test: dim/model migration must re-embed existing chunks.
 *
 * Bug: ensureVecTable() dropped+recreated vec_chunks empty on a dim/model_id
 * mismatch, but notes/chunks rows remained. reconcile() skipped unchanged
 * hashes, and forcedReindexIfNeeded() was blocked by a pre-existing sentinel.
 * Result: vec_chunks stayed empty and vectorKNN returned zero hits indefinitely.
 *
 * Fix: when the migration fires, delete all reindexed-*.txt sentinels so
 * forcedReindexIfNeeded() runs reindexAll() on the next session start and
 * repopulates the vectors.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { EMBED_DIM, MODEL_ID } from "../src/embed.js";
import { forcedReindexIfNeeded } from "../src/indexer.js";
import { openIndex } from "../src/searchIndex.js";
import { quantizeToInt8, serializeInt8ForSql } from "../src/staticEmbed/int8Quant.js";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dim-migrate-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dim-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_VAULT_DIR;
});

describe("dim/model migration self-heal", () => {
  it("vectorKNN returns pre-existing notes after a dim/model migration (not left empty)", async () => {
    const dbPath = path.join(TMP_DATA, "index-v2.db");
    fs.mkdirSync(TMP_DATA, { recursive: true });

    // --- Phase 1: seed a DB as if it were indexed under an OLD dim/model ---
    // We build the schema manually to simulate a previously-indexed database
    // with old dim=384 and old model_id "sentence-transformers/old-model".
    const OLD_DIM = 384;
    const OLD_MODEL = "sentence-transformers/old-model";
    const seedDb = new Database(dbPath);
    sqliteVec.load(seedDb);
    seedDb.exec(`
      CREATE TABLE IF NOT EXISTS embed_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS notes (rel_path TEXT PRIMARY KEY, mtime INTEGER, hash TEXT, project TEXT, created TEXT);
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY, rel_path TEXT, heading_path TEXT, anchor TEXT, text TEXT);
      CREATE INDEX IF NOT EXISTS chunks_rel ON chunks(rel_path);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='');
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(chunk_id integer primary key, embedding int8[${OLD_DIM}]);
    `);
    seedDb.prepare("INSERT INTO embed_meta(key,value) VALUES ('dim',?)").run(String(OLD_DIM));
    seedDb.prepare("INSERT INTO embed_meta(key,value) VALUES ('model_id',?)").run(OLD_MODEL);

    // Insert note + chunk metadata
    seedDb.prepare("INSERT INTO notes(rel_path,mtime,hash) VALUES (?,?,?)").run("decisions/alpha.md", 1000, "hash-old");
    const chunkId = Number(seedDb.prepare(
      "INSERT INTO chunks(rel_path,heading_path,anchor,text) VALUES (?,?,?,?)"
    ).run("decisions/alpha.md", "Decisions", "decisions", "chose sqlite over postgres").lastInsertRowid);

    // Insert into old vec_chunks with OLD_DIM vector
    const oldVec = new Float32Array(OLD_DIM).fill(0.1);
    const oldQ = quantizeToInt8(oldVec);
    const oldSer = serializeInt8ForSql(oldQ);
    seedDb.prepare("INSERT INTO vec_chunks(chunk_id,embedding) VALUES (?,vec_int8(?))").run(BigInt(chunkId), oldSer);

    // Insert into FTS
    seedDb.prepare("INSERT INTO chunks_fts(rowid,text) VALUES (?,?)").run(chunkId, "Decisions chose sqlite over postgres");
    seedDb.close();

    // Write a note file to disk so reindexAll() can re-embed it
    fs.mkdirSync(path.join(TMP_VAULT, "decisions"), { recursive: true });
    fs.writeFileSync(
      path.join(TMP_VAULT, "decisions/alpha.md"),
      "---\ntype: decision\n---\n## Decisions\nchose sqlite over postgres"
    );

    // Write a pre-existing version sentinel to simulate an already-upgraded install
    const sentinelFile = path.join(TMP_DATA, "reindexed-0.7.1.txt");
    fs.writeFileSync(sentinelFile, new Date().toISOString() + "\n", "utf8");
    expect(fs.existsSync(sentinelFile)).toBe(true);

    // --- Phase 2: open the index with the NEW dim/model - migration fires ---
    // At this point vec_chunks gets dropped+recreated empty (new EMBED_DIM, new MODEL_ID)
    // The fix must also delete the sentinel so that forcedReindexIfNeeded triggers reindexAll.
    const ix = openIndex();
    const vecCount = ix.db.prepare("SELECT count(*) as c FROM vec_chunks").get() as { c: number };
    expect(vecCount.c).toBe(0); // vec_chunks is empty right after migration

    // Confirm meta was updated to new values
    const newDim = ix.db.prepare("SELECT value FROM embed_meta WHERE key='dim'").get() as { value: string };
    const newModel = ix.db.prepare("SELECT value FROM embed_meta WHERE key='model_id'").get() as { value: string };
    expect(newDim.value).toBe(String(EMBED_DIM));
    expect(newModel.value).toBe(MODEL_ID);
    ix.close();

    // Sentinel must have been deleted so forcedReindexIfNeeded will run reindexAll
    expect(fs.existsSync(sentinelFile)).toBe(false);

    // --- Phase 3: forcedReindexIfNeeded runs (as sb-reconcile would on next session) ---
    const didReindex = await forcedReindexIfNeeded("0.7.1", TMP_DATA);
    expect(didReindex).toBe(true);

    // --- Phase 4: verify vec_chunks is repopulated and vectorKNN returns the note ---
    const ixAfter = openIndex();
    const vecCountAfter = ixAfter.db.prepare("SELECT count(*) as c FROM vec_chunks").get() as { c: number };
    expect(vecCountAfter.c).toBeGreaterThan(0);

    // Use a query vector and confirm the note is found
    const queryVec = new Float32Array(EMBED_DIM).fill(0.1);
    const hits = ixAfter.vectorKNN(queryVec, 5);
    ixAfter.close();

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].relPath).toBe("decisions/alpha.md");
  });
});
