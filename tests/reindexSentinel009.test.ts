import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { forcedReindexIfNeeded, reconcile } from "../src/indexer";
import { openIndex } from "../src/searchIndex";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sentinel009-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sentinel009-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.mkdirSync(path.join(TMP_VAULT, "decisions"), { recursive: true });
});

afterEach(() => {
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_EMBED_STUB;
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

describe("reindex sentinel 009: note_type/agent_role backfill", () => {
  it("forcedReindexIfNeeded 0.9.0 populates note_type and agent_role for pre-existing NULLs, no-ops on second call", async () => {
    fs.writeFileSync(
      path.join(TMP_VAULT, "decisions/g.md"),
      "---\ntype: decision\nagent_role: engineer\nproject: global\ncreated: 2026-01-01\n---\nbody content here\n",
    );
    await reconcile();

    const db1 = new Database(path.join(TMP_DATA, "index.db"));
    db1.prepare("UPDATE notes SET note_type=NULL, agent_role=NULL WHERE rel_path=?").run("decisions/g.md");
    db1.close();

    const ix0 = openIndex();
    const metaBefore = ix0.getFilterMeta(["decisions/g.md"]);
    ix0.close();
    expect(metaBefore.get("decisions/g.md")?.type).toBeNull();
    expect(metaBefore.get("decisions/g.md")?.agentRole).toBeNull();

    const ran = await forcedReindexIfNeeded("0.9.0", TMP_DATA);
    expect(ran).toBe(true);
    expect(fs.existsSync(path.join(TMP_DATA, "reindexed-0.9.0.txt"))).toBe(true);

    const ix1 = openIndex();
    const metaAfter = ix1.getFilterMeta(["decisions/g.md"]);
    ix1.close();
    expect(metaAfter.get("decisions/g.md")?.type).toBe("decision");
    expect(metaAfter.get("decisions/g.md")?.agentRole).toBe("engineer");

    const db2 = new Database(path.join(TMP_DATA, "index.db"));
    db2.prepare("UPDATE notes SET note_type=NULL, agent_role=NULL WHERE rel_path=?").run("decisions/g.md");
    db2.close();

    const ran2 = await forcedReindexIfNeeded("0.9.0", TMP_DATA);
    expect(ran2).toBe(false);

    const ix2 = openIndex();
    const metaNoChange = ix2.getFilterMeta(["decisions/g.md"]);
    ix2.close();
    expect(metaNoChange.get("decisions/g.md")?.type).toBeNull();
    expect(metaNoChange.get("decisions/g.md")?.agentRole).toBeNull();
  });
});
