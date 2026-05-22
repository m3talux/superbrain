import { describe, it, expect, vi } from "vitest";
import { dedupAgainstSession, dedupAgainstVault } from "../src/distillDedup.js";
import { DistilledItem } from "../src/router.js";

// Mock embed to return deterministic vectors.
vi.mock("../src/embed.js", () => ({
  embed: vi.fn(async (texts: string[]) => {
    return texts.map((text: string) => {
      // Simple deterministic stub: vectors derived from text length and first word.
      // Two texts whose first word matches → very high cosine (near 1.0).
      const firstWord = text.split(/\s+/)[0]?.toLowerCase() || "";
      const dim = 16;
      const v = new Float32Array(dim);
      // Place mass on a slot determined by the first word's hash; same first word → same slot.
      let h = 0;
      for (const c of firstWord) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
      v[h % dim] = 1;
      return v;
    });
  }),
}));

function item(title: string, body: string): DistilledItem {
  return { kind: "capture", title, date: "2026-05-22", links: [], body };
}

describe("dedupAgainstSession", () => {
  it("collapses 11 near-paraphrases of the same topic", async () => {
    const items = Array.from({ length: 11 }, (_, i) =>
      item(`inject feature ${i}`, `SuperBrain should support a /inject command for freeform text ${i}`)
    );
    const out = await dedupAgainstSession(items);
    expect(out.kept.length).toBe(1);
    expect(out.collapsed.length).toBe(10);
    // every collapsed item points at the first kept item (index 0)
    out.collapsed.forEach((c) => expect(c.intoIndex).toBe(0));
  });

  it("preserves items below similarity threshold", async () => {
    const items = [
      item("inject feature", "freeform text routing"),
      item("router fix", "daily mis-route to capture folder"),
    ];
    const out = await dedupAgainstSession(items);
    expect(out.kept.length).toBe(2);
    expect(out.collapsed.length).toBe(0);
  });

  it("returns empty for empty input", async () => {
    expect(await dedupAgainstSession([])).toEqual({ kept: [], collapsed: [] });
  });

  it("returns single item as kept", async () => {
    const xs = [item("alone", "only one")];
    const out = await dedupAgainstSession(xs);
    expect(out.kept).toEqual(xs);
    expect(out.collapsed).toEqual([]);
  });

  it("respects custom threshold", async () => {
    // With a threshold above 1.0, nothing can ever be collapsed.
    const items = [
      item("inject one", "body"),
      item("inject two", "body"),
    ];
    const out = await dedupAgainstSession(items, 1.01); // unreachable threshold
    expect(out.kept.length).toBe(2);
  });
});

describe("dedupAgainstVault", () => {
  it("returns match when score >= threshold", async () => {
    const searchFn = vi.fn(async () => [{ path: "decisions/foo.md", score: 0.9 }]);
    const r = await dedupAgainstVault({ title: "Use BM25", body: "body", type: "decision", project: "superbrain" }, searchFn);
    expect(r.match).toBe("decisions/foo.md");
    expect(r.score).toBe(0.9);
  });

  it("returns empty when score < threshold", async () => {
    const searchFn = vi.fn(async () => [{ path: "decisions/foo.md", score: 0.6 }]);
    const r = await dedupAgainstVault({ title: "x", body: "y", type: "decision", project: "superbrain" }, searchFn);
    expect(r.match).toBeUndefined();
  });

  it("returns empty when no results", async () => {
    const searchFn = vi.fn(async () => []);
    const r = await dedupAgainstVault({ title: "x", body: "y", type: "decision", project: "superbrain" }, searchFn);
    expect(r.match).toBeUndefined();
  });

  it("passes type and project filters to searchFn", async () => {
    const searchFn = vi.fn(async () => []);
    await dedupAgainstVault({ title: "x", body: "y", type: "decision", project: "superbrain" }, searchFn);
    expect(searchFn).toHaveBeenCalledWith(
      expect.stringContaining("x"),
      expect.objectContaining({ k: 1, type: "decision", project: "superbrain" })
    );
  });

  it("respects custom threshold", async () => {
    const searchFn = vi.fn(async () => [{ path: "decisions/foo.md", score: 0.86 }]);
    const r = await dedupAgainstVault({ title: "x", body: "y", type: "decision" }, searchFn, 0.95);
    expect(r.match).toBeUndefined();
  });
});
