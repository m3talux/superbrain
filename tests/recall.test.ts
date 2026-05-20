import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex } from "../src/searchIndex";
import { bm25Recall, hybridRecall } from "../src/recall";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-recall-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  const ix = openIndex();
  ix.upsertNote("decisions/2026-05-01-vec.md", 1, "h", [
    { headingPath: "", anchor: "", text: "we chose sqlite-vec over chromadb for local vectors" },
  ], [Float32Array.from(Array(384).fill(0.5))]);
  ix.close();
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("recall", () => {
  it("bm25Recall returns pointers without loading embeddings", async () => {
    const r = await bm25Recall("sqlite-vec", 3);
    expect(r[0].relPath).toBe("decisions/2026-05-01-vec.md");
    expect(r[0].text ?? r[0].excerpt).toContain("sqlite-vec");
  });
  it("hybridRecall returns pointers (embed via stub)", async () => {
    const r = await hybridRecall("local vector database", 3);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].relPath).toBe("decisions/2026-05-01-vec.md");
  });
  it("hybridRecall degrades to bm25 if embedding throws", async () => {
    delete process.env.SUPERBRAIN_EMBED_STUB;
    process.env.SUPERBRAIN_EMBED_FORCE_FAIL = "1";
    const r = await hybridRecall("sqlite-vec", 3);
    expect(r[0].relPath).toBe("decisions/2026-05-01-vec.md");
    delete process.env.SUPERBRAIN_EMBED_FORCE_FAIL;
  });
});
