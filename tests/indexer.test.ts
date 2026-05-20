import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { indexNote, reconcile } from "../src/indexer";
import { openIndex } from "../src/searchIndex";

beforeEach(() => {
  process.env.SUPERBRAIN_DATA_DIR = "/tmp/sb-indexer";
  process.env.SUPERBRAIN_VAULT_DIR = "/tmp/sb-indexer-vault";
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.rmSync("/tmp/sb-indexer", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-indexer-vault", { recursive: true, force: true });
  fs.mkdirSync("/tmp/sb-indexer-vault/decisions", { recursive: true });
});

describe("indexer", () => {
  it("indexNote indexes a single file's chunks", async () => {
    fs.writeFileSync("/tmp/sb-indexer-vault/decisions/a.md",
      "---\ntype: decision\nstatus: active\n---\n## D\npicked raft over paxos");
    await indexNote("decisions/a.md");
    const ix = openIndex();
    expect(ix.bm25("raft", 5)[0].relPath).toBe("decisions/a.md");
    ix.close();
  });
  it("reconcile adds new, updates changed, deletes removed, no-ops unchanged", async () => {
    const f = "/tmp/sb-indexer-vault/decisions/b.md";
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
    fs.mkdirSync("/tmp/sb-indexer-vault/.trash", { recursive: true });
    fs.writeFileSync("/tmp/sb-indexer-vault/.trash/old.md", "## x\ntrashed");
    await reconcile();
    const ix = openIndex();
    expect(ix.bm25("trashed", 5).length).toBe(0);
    ix.close();
  });
});
