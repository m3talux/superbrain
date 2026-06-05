import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex } from "../src/searchIndex";
import { hybridRecall } from "../src/recall";
import * as embedMod from "../src/embed";

let TMP: string;

const STUB_VEC = Float32Array.from(Array(256).fill(0.5));

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

  it("hybridRecall always invokes embed (bm25Only removed in B2)", async () => {
    // B2: bm25Only option is removed; embed is always called for hybrid fusion.
    const spy = vi.spyOn(embedMod, "embed");
    const r = await hybridRecall("sqlite-vec", 3);
    expect(spy).toHaveBeenCalled();
    expect(r[0].relPath).toBe("decisions/2026-05-01-vec.md");
    spy.mockRestore();
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
      [{ headingPath: "", anchor: "root", text: "hybrid fusion topic alpha-proj" }],
      [STUB_VEC],
      "alpha-proj",
    );
    ix.upsertNote(
      "decisions/glob.md", 2, "h-gl",
      [{ headingPath: "", anchor: "root", text: "hybrid fusion topic global" }],
      [STUB_VEC],
      "global",
    );
    ix.close();
  }

  it("same-project notes appear and cross-project notes are excluded", async () => {
    seedProjectNotes();
    const results = await hybridRecall("hybrid fusion topic", 5, { projectSlug: "superbrain" });
    const relPaths = results.map((r) => r.relPath);
    expect(relPaths).toContain("decisions/sb1.md");
    expect(relPaths).not.toContain("decisions/we1.md");
  });

  it("global-project notes appear when projectSlug is set; cross-project notes are excluded", async () => {
    seedProjectNotes();
    const results = await hybridRecall("hybrid fusion topic", 5, { projectSlug: "superbrain" });
    const relPaths = results.map((r) => r.relPath);
    expect(relPaths).toContain("decisions/glob.md");
    expect(relPaths).not.toContain("decisions/we1.md");
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

describe("project-scoped recall — hard exclusion", () => {
  const STUB = Float32Array.from(Array(256).fill(0.5));

  function seedMultiProject() {
    const ix = openIndex();
    ix.upsertNote(
      "proj/a1.md", 1, "ha1",
      [{ headingPath: "", anchor: "root", text: "hybrid recall topic alpha project" }],
      [STUB], "proj-a",
    );
    ix.upsertNote(
      "proj/b1.md", 1, "hb1",
      [{ headingPath: "", anchor: "root", text: "hybrid recall topic alpha project" }],
      [STUB], "proj-b",
    );
    ix.upsertNote(
      "proj/glob.md", 1, "hgl",
      [{ headingPath: "", anchor: "root", text: "hybrid recall topic alpha project" }],
      [STUB], "global",
    );
    ix.upsertNote(
      "proj/none.md", 1, "hno",
      [{ headingPath: "", anchor: "root", text: "hybrid recall topic alpha project" }],
      [STUB],
    );
    ix.close();
  }

  it("excludes notes from a different concrete project when projectSlug is set", async () => {
    seedMultiProject();
    const results = await hybridRecall("hybrid recall topic alpha", 10, { projectSlug: "proj-a" });
    const relPaths = results.map((r) => r.relPath);
    expect(relPaths).not.toContain("proj/b1.md");
    expect(relPaths).toContain("proj/a1.md");
  });

  it("allows global-tagged notes through the project filter", async () => {
    seedMultiProject();
    const results = await hybridRecall("hybrid recall topic alpha", 10, { projectSlug: "proj-a" });
    const relPaths = results.map((r) => r.relPath);
    expect(relPaths).toContain("proj/glob.md");
  });

  it("excludes project-less (NULL) notes through the fail-closed filter when project active", async () => {
    // B2 fail-closed: NULL project notes are excluded when a project is active.
    // After backfill all notes are tagged; during the transition window,
    // ambiguous NULL notes are excluded to prevent cross-project leakage.
    seedMultiProject();
    const results = await hybridRecall("hybrid recall topic alpha", 10, { projectSlug: "proj-a" });
    const relPaths = results.map((r) => r.relPath);
    expect(relPaths).not.toContain("proj/none.md");
  });

  it("no cross-project leakage when projectSlug is set (both bm25 and vector arms)", async () => {
    seedMultiProject();
    const results = await hybridRecall("hybrid recall topic alpha", 10, { projectSlug: "proj-a" });
    const leaked = results.filter((r) => r.relPath === "proj/b1.md");
    expect(leaked).toHaveLength(0);
  });

  it("does not filter when projectSlug is undefined", async () => {
    seedMultiProject();
    const results = await hybridRecall("hybrid recall topic alpha", 10);
    const relPaths = results.map((r) => r.relPath);
    expect(relPaths).toContain("proj/b1.md");
    expect(relPaths).toContain("proj/a1.md");
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
