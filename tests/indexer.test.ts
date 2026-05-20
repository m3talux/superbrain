import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { indexNote, reconcile } from "../src/indexer";
import { openIndex } from "../src/searchIndex";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-indexer-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-indexer-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.mkdirSync(path.join(TMP_VAULT, "decisions"), { recursive: true });
});

afterEach(() => {
  // Windows briefly retains the better-sqlite3 file handle after close();
  // maxRetries+retryDelay rides it out instead of failing with EBUSY.
  fs.rmSync(TMP_DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("indexer", () => {
  it("indexNote indexes a single file's chunks", async () => {
    fs.writeFileSync(path.join(TMP_VAULT, "decisions/a.md"),
      "---\ntype: decision\nstatus: active\n---\n## D\npicked raft over paxos");
    await indexNote("decisions/a.md");
    const ix = openIndex();
    expect(ix.bm25("raft", 5)[0].relPath).toBe("decisions/a.md");
    ix.close();
  });
  it("reconcile adds new, updates changed, deletes removed, no-ops unchanged", async () => {
    const f = path.join(TMP_VAULT, "decisions/b.md");
    fs.writeFileSync(f, "---\ntype: decision\nstatus: active\n---\noriginal alpha");
    let s = await reconcile();
    expect(s).toMatchObject({ added: 1 });
    s = await reconcile(); // unchanged
    expect(s).toMatchObject({ added: 0, updated: 0, deleted: 0 });
    fs.writeFileSync(f, "---\ntype: decision\nstatus: active\n---\nrewritten beta");
    s = await reconcile();
    expect(s).toMatchObject({ updated: 1 });
    const ix = openIndex();
    expect(ix.bm25("alpha", 5).length).toBe(0);
    expect(ix.bm25("beta", 5)[0].relPath).toBe("decisions/b.md");
    ix.close();
    fs.rmSync(f);
    s = await reconcile();
    expect(s).toMatchObject({ deleted: 1 });
  });
  it("reconcile skips .trash and .obsidian", async () => {
    fs.mkdirSync(path.join(TMP_VAULT, ".trash"), { recursive: true });
    fs.writeFileSync(path.join(TMP_VAULT, ".trash/old.md"), "## x\ntrashed");
    await reconcile();
    const ix = openIndex();
    expect(ix.bm25("trashed", 5).length).toBe(0);
    ix.close();
  });
});
