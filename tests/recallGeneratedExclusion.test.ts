import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex } from "../src/searchIndex.js";
import { hybridRecall } from "../src/recall.js";
import { embed } from "../src/embed.js";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-gen-excl-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});

afterEach(() => {
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_EMBED_STUB;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("generated note exclusion from recall", () => {
  it("generated map note does not appear in recall results while real note does", async () => {
    const text = "pick raft consensus algorithm leader election fault tolerance";
    const [vec] = await embed([text]);

    const ix = openIndex();
    ix.upsertNote(
      "maps/alpha-index.md", 1, "hash-gen",
      [{ headingPath: "", anchor: "root", text }],
      [vec],
      "alpha",
      "2026-01-01",
      "map",
      undefined,
      true,
    );
    ix.upsertNote(
      "decisions/pick-raft.md", 1, "hash-real",
      [{ headingPath: "", anchor: "root", text }],
      [vec],
      "alpha",
      "2026-01-01",
      "decision",
      undefined,
      false,
    );
    ix.close();

    const results = await hybridRecall(text, 10);
    const paths = results.map((r) => r.relPath);
    expect(paths).toContain("decisions/pick-raft.md");
    expect(paths).not.toContain("maps/alpha-index.md");
  });

  it("generated map note does not appear in project-scoped recall or fallback fill", async () => {
    const text = "alpha project index map navigation generated content artifact";
    const [vec] = await embed([text]);

    const ix = openIndex();
    ix.upsertNote(
      "maps/alpha-index.md", 1, "hash-gen2",
      [{ headingPath: "", anchor: "root", text }],
      [vec],
      "alpha",
      "2026-01-01",
      "map",
      undefined,
      true,
    );
    ix.upsertNote(
      "decisions/real-decision.md", 1, "hash-real2",
      [{ headingPath: "", anchor: "root", text }],
      [vec],
      "alpha",
      "2026-01-01",
      "decision",
      undefined,
      false,
    );
    ix.close();

    const results = await hybridRecall(text, 10, { projectSlug: "alpha" });
    const paths = results.map((r) => r.relPath);
    expect(paths).toContain("decisions/real-decision.md");
    expect(paths).not.toContain("maps/alpha-index.md");
  });
});
