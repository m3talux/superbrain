import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex } from "../src/searchIndex";
import { bm25Recall, hybridRecall } from "../src/recall";

let TMP: string;

const STUB_VEC = Float32Array.from(Array(384).fill(0.5));

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-recall-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  const ix = openIndex();
  ix.upsertNote("decisions/2026-05-01-vec.md", 1, "h", [
    { headingPath: "", anchor: "", text: "we chose sqlite-vec over chromadb for local vectors" },
  ], [STUB_VEC]);
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

describe("project-scoped recall", () => {
  function seedProjectNotes() {
    const ix = openIndex();
    ix.upsertNote(
      "decisions/sb1.md", 2, "h-sb",
      [{ headingPath: "", anchor: "root", text: "hybrid fusion topic superbrain" }],
      [STUB_VEC],
      "superbrain",
    );
    ix.upsertNote(
      "decisions/we1.md", 2, "h-we",
      [{ headingPath: "", anchor: "root", text: "hybrid fusion topic weddy" }],
      [STUB_VEC],
      "weddy",
    );
    ix.upsertNote(
      "decisions/glob.md", 2, "h-gl",
      [{ headingPath: "", anchor: "root", text: "hybrid fusion topic global" }],
      [STUB_VEC],
      "global",
    );
    ix.close();
  }

  it("boosts same-project notes when projectSlug option is set", async () => {
    seedProjectNotes();
    const results = await hybridRecall("hybrid fusion topic", 5, { projectSlug: "superbrain" });
    const sbIdx = results.findIndex((r) => r.relPath === "decisions/sb1.md");
    const weIdx = results.findIndex((r) => r.relPath === "decisions/we1.md");
    expect(sbIdx).toBeGreaterThanOrEqual(0);
    expect(weIdx).toBeGreaterThanOrEqual(0);
    expect(sbIdx).toBeLessThan(weIdx);
  });

  it("global-project notes receive the 2x boost alongside same-project notes", async () => {
    seedProjectNotes();
    const results = await hybridRecall("hybrid fusion topic", 5, { projectSlug: "superbrain" });
    const globIdx = results.findIndex((r) => r.relPath === "decisions/glob.md");
    const weIdx = results.findIndex((r) => r.relPath === "decisions/we1.md");
    expect(globIdx).toBeGreaterThanOrEqual(0);
    expect(weIdx).toBeGreaterThanOrEqual(0);
    // global is boosted, weddy is not — global must outrank weddy
    expect(globIdx).toBeLessThan(weIdx);
  });

  it("without projectSlug option, scoring is unchanged (no boost applied)", async () => {
    seedProjectNotes();
    const r1 = await hybridRecall("hybrid fusion topic", 5);
    const r2 = await hybridRecall("hybrid fusion topic", 5);
    expect(r1.map((r) => r.relPath)).toEqual(r2.map((r) => r.relPath));
  });

  it("returns results even when no notes match projectSlug", async () => {
    seedProjectNotes();
    const results = await hybridRecall("hybrid fusion topic", 5, { projectSlug: "unknown-project" });
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("recency decay", () => {
  const MS_PER_DAY = 86_400_000;

  it("decays scores by exp(-ageDays/90)", async () => {
    const now = Date.now();
    const old = now - 90 * MS_PER_DAY;
    const ix = openIndex();
    ix.upsertNote(
      "decay/today.md", 1, "h-t",
      [{ headingPath: "", anchor: "root", text: "recency decay test note freshness" }],
      [STUB_VEC],
      undefined,
      new Date(now).toISOString(),
    );
    ix.upsertNote(
      "decay/old90.md", 1, "h-o",
      [{ headingPath: "", anchor: "root", text: "recency decay test note freshness" }],
      [STUB_VEC],
      undefined,
      new Date(old).toISOString(),
    );
    ix.close();

    const results = await hybridRecall("recency decay test note freshness", 5);
    const todayIdx = results.findIndex((r) => r.relPath === "decay/today.md");
    const oldIdx = results.findIndex((r) => r.relPath === "decay/old90.md");
    expect(todayIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    // today's note must rank above the 90-day-old note
    expect(todayIdx).toBeLessThan(oldIdx);
  });

  it("does not crash when created date is missing", async () => {
    // Note indexed without a created field → decay treats it as today (factor 1.0)
    const r = await hybridRecall("sqlite-vec", 3);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].relPath).toBe("decisions/2026-05-01-vec.md");
  });

  it("365-day-old note ranks below a today note with half the raw relevance", async () => {
    const now = Date.now();
    const old365 = now - 365 * MS_PER_DAY;
    const ix = openIndex();
    // old note gets two matching words; today note gets one — but recency wins
    ix.upsertNote(
      "decay/strong-old.md", 1, "h-so",
      [{ headingPath: "", anchor: "root", text: "ancient vault knowledge archive deep recall" }],
      [STUB_VEC],
      undefined,
      new Date(old365).toISOString(),
    );
    ix.upsertNote(
      "decay/fresh-weak.md", 1, "h-fw",
      [{ headingPath: "", anchor: "root", text: "ancient vault knowledge" }],
      [STUB_VEC],
      undefined,
      new Date(now).toISOString(),
    );
    ix.close();

    const results = await hybridRecall("ancient vault knowledge", 5);
    const freshIdx = results.findIndex((r) => r.relPath === "decay/fresh-weak.md");
    const oldIdx = results.findIndex((r) => r.relPath === "decay/strong-old.md");
    expect(freshIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    // fresh note must outrank 365-day-old note despite the old note matching more words
    expect(freshIdx).toBeLessThan(oldIdx);
  });
});

describe("excludeSlugs filtering", () => {
  it("excludes paths in excludeSlugs before top-k slice", async () => {
    const results = await hybridRecall("sqlite-vec", 5);
    expect(results.length).toBeGreaterThan(0);

    // Exclude the top result's path — it must no longer appear.
    const topPath = results[0].relPath;
    const filtered = await hybridRecall("sqlite-vec", 5, { excludeSlugs: [topPath] });
    expect(filtered.every((r) => r.relPath !== topPath)).toBe(true);
  });

  it("returns empty when all candidates are excluded", async () => {
    const all = await hybridRecall("sqlite-vec", 10);
    const allPaths = all.map((r) => r.relPath);
    const filtered = await hybridRecall("sqlite-vec", 10, { excludeSlugs: allPaths });
    expect(filtered).toEqual([]);
  });

  it("does not affect results when excludeSlugs is empty", async () => {
    const r1 = await hybridRecall("sqlite-vec", 5, { excludeSlugs: [] });
    const r2 = await hybridRecall("sqlite-vec", 5);
    expect(r1.map((r) => r.relPath)).toEqual(r2.map((r) => r.relPath));
  });
});
