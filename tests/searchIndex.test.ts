import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex, rrf } from "../src/searchIndex";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-idx-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const vec = (n: number) => Float32Array.from(Array(384).fill(n));

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
