import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
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
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
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

  it("populates vault_edges from frontmatter when indexing a note", async () => {
    fs.writeFileSync(
      path.join(TMP_VAULT, "decisions/c.md"),
      "---\ntype: decision\nproject: alpha\ncreated: 2024-01-15\n---\n## D\nsome decision"
    );
    await indexNote("decisions/c.md");
    const db = new Database(path.join(TMP_DATA, "index.db"));
    const rows = db.prepare("SELECT from_path, to_path, kind FROM vault_edges ORDER BY kind").all() as {
      from_path: string; to_path: string; kind: string;
    }[];
    db.close();
    expect(rows.some((r) => r.kind === "project" && r.to_path === "projects/alpha.md")).toBe(true);
    expect(rows.some((r) => r.kind === "daily" && r.to_path === "daily/2024-01-15.md")).toBe(true);
  });

  it("removes stale edges when a note is re-indexed", async () => {
    const f = path.join(TMP_VAULT, "decisions/d.md");
    fs.writeFileSync(f, "---\ntype: decision\nproject: alpha\ncreated: 2024-01-15\n---\n## D\nfirst");
    await indexNote("decisions/d.md");

    // Change project and re-index
    fs.writeFileSync(f, "---\ntype: decision\nproject: beta\ncreated: 2024-01-15\n---\n## D\nupdated");
    await indexNote("decisions/d.md");

    const db = new Database(path.join(TMP_DATA, "index.db"));
    const rows = db.prepare("SELECT to_path, kind FROM vault_edges WHERE from_path = ?").all("decisions/d.md") as {
      to_path: string; kind: string;
    }[];
    db.close();
    expect(rows.some((r) => r.kind === "project" && r.to_path === "projects/beta.md")).toBe(true);
    expect(rows.every((r) => r.to_path !== "projects/alpha.md")).toBe(true);
  });
});
