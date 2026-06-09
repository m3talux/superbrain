import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { indexNote, reconcile, reindexAll, forcedReindexIfNeeded } from "../src/indexer";
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

  it("reconcile indexes a note in a non-standard subfolder (blocklist is the only exclusion)", async () => {
    fs.mkdirSync(path.join(TMP_VAULT, "research/notebooks"), { recursive: true });
    fs.writeFileSync(
      path.join(TMP_VAULT, "research/notebooks/quokka.md"),
      "---\ntype: capture\n---\n## Q\nquokkazidine is a made-up token"
    );
    const s = await reconcile();
    expect(s).toMatchObject({ added: 1 });
    const ix = openIndex();
    expect(ix.bm25("quokkazidine", 5)[0].relPath).toBe("research/notebooks/quokka.md");
    expect(ix.allIndexedPaths()).toContain("research/notebooks/quokka.md");
    ix.close();
  });

  it("populates vault_edges from frontmatter when indexing a note", async () => {
    fs.writeFileSync(
      path.join(TMP_VAULT, "decisions/c.md"),
      "---\ntype: decision\nproject: alpha\ncreated: 2024-01-15\n---\n## D\nsome decision"
    );
    await indexNote("decisions/c.md");
    const db = new Database(path.join(TMP_DATA, "index-v2.db"));
    const rows = db.prepare("SELECT from_path, to_path, kind FROM vault_edges ORDER BY kind").all() as {
      from_path: string; to_path: string; kind: string;
    }[];
    db.close();
    expect(rows.some((r) => r.kind === "project" && r.to_path === "projects/alpha.md")).toBe(true);
    expect(rows.some((r) => r.kind === "daily" && r.to_path === "daily/2024-01-15.md")).toBe(true);
  });

  it("reindexAll updates stale index project without content change", async () => {
    // Simulate a note already in the index with project=undefined (stale, e.g. pre-attribution)
    // while its on-disk frontmatter declares project: foo.
    const f = path.join(TMP_VAULT, "decisions/e.md");
    fs.writeFileSync(f, "---\ntype: decision\nproject: foo\n---\n## E\nsome content");
    // First reconcile — gets indexed with project=foo correctly.
    await reconcile();
    // Directly overwrite the project column to NULL to simulate a stale index row
    // (as would exist for users who indexed before cwd attribution was added).
    const db = new Database(path.join(TMP_DATA, "index-v2.db"));
    db.prepare("UPDATE notes SET project=NULL WHERE rel_path=?").run("decisions/e.md");
    db.close();
    // Normal reconcile leaves it alone because the hash hasn't changed.
    await reconcile();
    const ixBefore = openIndex();
    const projectsBefore = ixBefore.getProjectsForPaths(["decisions/e.md"]);
    ixBefore.close();
    expect(projectsBefore.get("decisions/e.md")).toBeUndefined();
    // Forced reindex must repair the stale project column.
    await reindexAll();
    const ixAfter = openIndex();
    const projectsAfter = ixAfter.getProjectsForPaths(["decisions/e.md"]);
    ixAfter.close();
    expect(projectsAfter.get("decisions/e.md")).toBe("foo");
  });

  it("removes stale edges when a note is re-indexed", async () => {
    const f = path.join(TMP_VAULT, "decisions/d.md");
    fs.writeFileSync(f, "---\ntype: decision\nproject: alpha\ncreated: 2024-01-15\n---\n## D\nfirst");
    await indexNote("decisions/d.md");

    // Change project and re-index
    fs.writeFileSync(f, "---\ntype: decision\nproject: beta\ncreated: 2024-01-15\n---\n## D\nupdated");
    await indexNote("decisions/d.md");

    const db = new Database(path.join(TMP_DATA, "index-v2.db"));
    const rows = db.prepare("SELECT to_path, kind FROM vault_edges WHERE from_path = ?").all("decisions/d.md") as {
      to_path: string; kind: string;
    }[];
    db.close();
    expect(rows.some((r) => r.kind === "project" && r.to_path === "projects/beta.md")).toBe(true);
    expect(rows.every((r) => r.to_path !== "projects/alpha.md")).toBe(true);
  });

  it("forcedReindexIfNeeded runs once for a version then is a no-op on second call", async () => {
    const f = path.join(TMP_VAULT, "decisions/f.md");
    fs.writeFileSync(f, "---\ntype: decision\nproject: bar\n---\n## F\ncontent for sentinel test");
    await reconcile();
    // Corrupt the project column to simulate a stale index.
    const db1 = new Database(path.join(TMP_DATA, "index-v2.db"));
    db1.prepare("UPDATE notes SET project=NULL WHERE rel_path=?").run("decisions/f.md");
    db1.close();
    // First call for version "0.0.1-test" triggers forced reindex and writes sentinel.
    const sentinel1 = await forcedReindexIfNeeded("0.0.1-test", TMP_DATA);
    expect(sentinel1).toBe(true);
    const sentinelPath = path.join(TMP_DATA, "reindexed-0.0.1-test.txt");
    expect(fs.existsSync(sentinelPath)).toBe(true);
    // The project column must now be repaired.
    const ixAfter = openIndex();
    const projects = ixAfter.getProjectsForPaths(["decisions/f.md"]);
    ixAfter.close();
    expect(projects.get("decisions/f.md")).toBe("bar");
    // Second call for the same version is a no-op (sentinel present).
    // Corrupt again to confirm reindex does NOT run.
    const db2 = new Database(path.join(TMP_DATA, "index-v2.db"));
    db2.prepare("UPDATE notes SET project=NULL WHERE rel_path=?").run("decisions/f.md");
    db2.close();
    const sentinel2 = await forcedReindexIfNeeded("0.0.1-test", TMP_DATA);
    expect(sentinel2).toBe(false);
    const ixNoChange = openIndex();
    const projectsNoChange = ixNoChange.getProjectsForPaths(["decisions/f.md"]);
    ixNoChange.close();
    expect(projectsNoChange.get("decisions/f.md")).toBeUndefined();
  });
});
