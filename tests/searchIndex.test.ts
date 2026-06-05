import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openIndex, rrf } from "../src/searchIndex";
import { serializeInt8ForSql, quantizeToInt8 } from "../src/staticEmbed/int8Quant.js";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-idx-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const vec = (n: number) => Float32Array.from(Array(256).fill(n));

describe("searchIndex", () => {
  it("upsert → bm25 + vectorKNN; re-upsert replaces; delete removes", () => {
    const ix = openIndex();
    ix.upsertNote("projects/x.md", 1, "h1", [
      { headingPath: "Decisions", anchor: "decisions", text: "chose sqlite-vec for vectors" },
    ], [vec(0.1)]);
    ix.upsertNote("people/y.md", 1, "h2", [
      { headingPath: "", anchor: "", text: "Jane leads the search team" },
    ], [vec(0.9)]);

    const bm = ix.bm25("sqlite-vec", 5);
    expect(bm[0].relPath).toBe("projects/x.md");
    const kn = ix.vectorKNN(vec(0.1), 1);
    expect(kn[0].relPath).toBe("projects/x.md");

    ix.upsertNote("projects/x.md", 2, "h1b", [
      { headingPath: "Decisions", anchor: "decisions", text: "switched to lancedb" },
    ], [vec(0.2)]);
    expect(ix.bm25("sqlite-vec", 5).length).toBe(0);
    expect(ix.bm25("lancedb", 5)[0].relPath).toBe("projects/x.md");

    ix.deleteNote("projects/x.md");
    expect(ix.bm25("lancedb", 5).length).toBe(0);
    ix.close();
  });
  it("rrf fuses ranked id lists", () => {
    expect(rrf([["a", "b", "c"], ["c", "a"]], 2)).toEqual(["a", "c"]);
  });
  it("tracks note hash/mtime for reconcile diffing", () => {
    const ix = openIndex();
    ix.upsertNote("a.md", 5, "hashA", [{ headingPath: "", anchor: "", text: "t" }], [vec(0.3)]);
    expect(ix.getNoteMeta("a.md")).toEqual({ mtime: 5, hash: "hashA" });
    expect(ix.getNoteMeta("missing.md")).toBeNull();
    expect(ix.allIndexedPaths()).toEqual(["a.md"]);
    ix.close();
  });
  it("vectorKNN hydrates rows even though sqlite-vec returns BigInt ids", () => {
    const ix = openIndex();
    ix.upsertNote("n/a.md", 1, "h", [{ headingPath: "", anchor: "", text: "alpha" }], [vec(0.05)]);
    ix.upsertNote("n/b.md", 1, "h", [{ headingPath: "", anchor: "", text: "beta" }], [vec(0.95)]);
    const r = ix.vectorKNN(vec(0.05), 1);
    expect(r.length).toBe(1);
    expect(r[0].relPath).toBe("n/a.md");
    expect(r[0].text).toBe("alpha");
    ix.close();
  });
  it("upsertNote with array project does not throw and indexes the note", () => {
    const ix = openIndex();
    expect(() =>
      ix.upsertNote("projects/z.md", 1, "h1",
        [{ headingPath: "", anchor: "", text: "wikilink project test" }],
        [vec(0.5)],
        ["projects/alpha-proj"] as any,
        "2026-05-28")
    ).not.toThrow();
    expect(ix.getNoteMeta("projects/z.md")).not.toBeNull();
    const bm = ix.bm25("wikilink project test", 5);
    expect(bm[0].relPath).toBe("projects/z.md");
    ix.close();
  });

  it("re-upsert/delete purges FTS heading terms (no stale contentless rows)", () => {
    const ix = openIndex();
    ix.upsertNote("p/h.md", 1, "h1",
      [{ headingPath: "Decisions", anchor: "decisions", text: "chose approach alpha" }],
      [vec(0.1)]);
    expect(ix.bm25("Decisions", 5).length).toBe(1);   // heading term searchable
    expect(ix.bm25("alpha", 5).length).toBe(1);
    // re-upsert same note with different heading+body
    ix.upsertNote("p/h.md", 2, "h2",
      [{ headingPath: "Gotchas", anchor: "gotchas", text: "bug beta" }],
      [vec(0.2)]);
    expect(ix.bm25("Decisions", 5).length).toBe(0);   // OLD heading term gone (no stale FTS row)
    expect(ix.bm25("alpha", 5).length).toBe(0);
    expect(ix.bm25("Gotchas", 5).length).toBe(1);     // new heading searchable
    // delete entirely
    ix.deleteNote("p/h.md");
    expect(ix.bm25("Gotchas", 5).length).toBe(0);     // heading term purged on delete too
    expect(ix.bm25("beta", 5).length).toBe(0);
    ix.close();
  });
});

describe("G7: prepared statements hoisted (no per-call prepare)", () => {
  it("does not call db.prepare after openIndex() when global methods are invoked", () => {
    const ix = openIndex();
    // Seed some global data
    ix.upsertNote("daily/2026-01-01.md", 1, "h1",
      [{ headingPath: "", anchor: "", text: "daily note content" }], [vec(0.1)],
      "global", "2026-01-01");
    ix.upsertNote("meta/preferences.md", 1, "h2",
      [{ headingPath: "", anchor: "", text: "preference content" }], [vec(0.2)],
      "global", "2026-01-01");

    // Spy on db.prepare AFTER openIndex returned
    const prepareSpy = vi.spyOn(ix.db, "prepare");

    // Call each global method 3 times
    for (let i = 0; i < 3; i++) {
      ix.bm25Global("daily note", 2);
      ix.vectorKNNGlobal(vec(0.1), 2);
      ix.globalFallbackNotes(2);
    }
    // Also call hydrate-using methods
    for (let i = 0; i < 3; i++) {
      ix.bm25("daily", 2);
      ix.vectorKNN(vec(0.1), 2);
    }

    expect(prepareSpy).not.toHaveBeenCalled();
    prepareSpy.mockRestore();
    ix.close();
  });
});

describe("G8: serializeInt8ForSql returns Buffer", () => {
  it("returns a Buffer whose byteLength equals the Int8Array length", () => {
    const v = new Float32Array(256).fill(0.5);
    const q = quantizeToInt8(v);
    const result = serializeInt8ForSql(q);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect((result as Buffer).byteLength).toBe(256);
  });

  it("round-trip: upsert with buffer int8 and vectorKNN returns correct hit", () => {
    const ix = openIndex();
    ix.upsertNote("test/buf.md", 1, "h",
      [{ headingPath: "", anchor: "", text: "buffer round trip" }],
      [vec(0.7)], "global", "2026-01-01");
    const hits = ix.vectorKNN(vec(0.7), 1);
    expect(hits.length).toBe(1);
    expect(hits[0].relPath).toBe("test/buf.md");
    ix.close();
  });
});

describe("G9: indexes on notes(project) and notes(created)", () => {
  it("EXPLAIN QUERY PLAN shows index scan for globalFallbackNotes query", () => {
    const ix = openIndex();
    ix.upsertNote("daily/2026-01-01.md", 1, "h",
      [{ headingPath: "", anchor: "", text: "indexed note" }], [vec(0.3)],
      "global", "2026-01-01");

    // Check that the notes_project index exists
    const indexes = ix.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notes'"
    ).all() as { name: string }[];
    const indexNames = indexes.map((r) => r.name);
    expect(indexNames).toContain("notes_project");
    expect(indexNames).toContain("notes_created");

    // EXPLAIN QUERY PLAN should not show SCAN TABLE for the global filter
    const plan = ix.db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT c.id FROM chunks c
      JOIN notes n ON n.rel_path = c.rel_path
      WHERE n.project = 'global'
      ORDER BY n.created DESC, c.id DESC
      LIMIT 10
    `).all() as { detail: string }[];
    const planStr = plan.map((r) => r.detail).join(" ");
    // Should use the notes_project or notes_created index, not a full table scan on notes
    expect(planStr).not.toMatch(/SCAN TABLE notes(?! USING)/);
    ix.close();
  });
});

describe("G10: unified global filter uses only project='global'", () => {
  it("returns a project='global' note at a non-daily path", () => {
    const ix = openIndex();
    ix.upsertNote("meta/custom.md", 1, "h",
      [{ headingPath: "", anchor: "", text: "cross cutting global knowledge" }],
      [vec(0.4)], "global", "2026-01-01");

    const bm = ix.bm25Global("cross cutting", 5);
    expect(bm.some((h) => h.relPath === "meta/custom.md")).toBe(true);

    const knn = ix.vectorKNNGlobal(vec(0.4), 5);
    expect(knn.some((h) => h.relPath === "meta/custom.md")).toBe(true);

    const fb = ix.globalFallbackNotes(5);
    expect(fb.some((h) => h.relPath === "meta/custom.md")).toBe(true);
    ix.close();
  });

  it("does NOT return a daily/ note with project=null after G10 fix", () => {
    const ix = openIndex();
    // Insert a note at daily/ path but with project=null (old behavior)
    ix.db.prepare(
      "INSERT OR REPLACE INTO notes(rel_path,mtime,hash,project,created) VALUES (?,?,?,?,?)"
    ).run("daily/2026-01-02.md", 1, "h2", null, "2026-01-02");
    ix.db.prepare("INSERT INTO chunks(rel_path,heading_path,anchor,text) VALUES (?,?,?,?)")
      .run("daily/2026-01-02.md", "", "", "null project daily note");
    const chunkId = ix.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    ix.db.prepare("INSERT INTO chunks_fts(rowid,text) VALUES (?,?)").run(chunkId.id, "null project daily note");

    const bm = ix.bm25Global("null project daily", 5);
    expect(bm.some((h) => h.relPath === "daily/2026-01-02.md")).toBe(false);

    const fb = ix.globalFallbackNotes(5);
    expect(fb.some((h) => h.relPath === "daily/2026-01-02.md")).toBe(false);
    ix.close();
  });
});
