import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { distillFromEvents } from "../src/distillRun";
import { openIndex } from "../src/searchIndex";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pidx-distill-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pidx-distill-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";

  fs.mkdirSync(path.join(TMP_VAULT, "projects"), { recursive: true });
  fs.mkdirSync(path.join(TMP_VAULT, "maps"), { recursive: true });
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });

  fs.writeFileSync(
    path.join(TMP_VAULT, "projects/alpha.md"),
    "---\ntype: project\nstatus: active\nproject: alpha\n---\n# Alpha\n\n## Recent activity\n",
  );

  const stub = {
    items: [
      {
        kind: "project_fact",
        title: "Alpha owns writes",
        date: "2026-02-01",
        project: "alpha",
        body: "Alpha is the sole writer for X with enough words to clear dedup and then some more words here",
      },
    ],
    digest: "Alpha session",
    openThreads: [],
    alsoDid: [],
  };
  const stubPath = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stubPath, JSON.stringify(stub));
  process.env.SUPERBRAIN_DISTILL_STUB = stubPath;
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_EMBED_STUB;
  delete process.env.SUPERBRAIN_DISTILL_STUB;
});

describe("projectIndexDistill", () => {
  it("distill regenerates touched project index", async () => {
    await distillFromEvents("test-sid", [
      { type: "tool", tool: "Write", file: "src/index.ts", cwd: "/some/alpha", ts: "t1" },
    ]);
    expect(fs.existsSync(path.join(TMP_VAULT, "maps/alpha-index.md"))).toBe(true);
    const content = fs.readFileSync(path.join(TMP_VAULT, "maps/alpha-index.md"), "utf8");
    expect(content).toContain("[[projects/alpha]]");
  });

  it("index note is added to search index", async () => {
    await distillFromEvents("test-sid", [
      { type: "tool", tool: "Write", file: "src/index.ts", cwd: "/some/alpha", ts: "t1" },
    ]);
    const ix = openIndex();
    try {
      expect(ix.allIndexedPaths()).toContain("maps/alpha-index.md");
    } finally {
      ix.close();
    }
  });
});
