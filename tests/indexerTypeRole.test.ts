import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex } from "../src/searchIndex";
import { indexNote } from "../src/indexer";

let TMP: string; let VAULT: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ixtr-"));
  VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_VAULT_DIR = VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});
afterEach(() => {
  delete process.env.SUPERBRAIN_DATA_DIR; delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_EMBED_STUB;
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(VAULT, { recursive: true, force: true });
});

describe("indexer populates note_type and agent_role", () => {
  it("reads type and agent_role from frontmatter", async () => {
    fs.mkdirSync(path.join(VAULT, "decisions"), { recursive: true });
    fs.writeFileSync(path.join(VAULT, "decisions/d.md"),
      "---\ntype: decision\nagent_role: planner\nproject: global\ncreated: 2026-01-01\n---\nbody text here\n");
    await indexNote("decisions/d.md");
    const ix = openIndex();
    const meta = ix.getFilterMeta(["decisions/d.md"]);
    ix.close();
    expect(meta.get("decisions/d.md")).toMatchObject({ type: "decision", agentRole: "planner" });
  });
});
