import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { deriveEdges, upsertEdges, ensureEdgesTable } from "../src/edges.js";

describe("deriveEdges", () => {
  it("derives project + daily edges from a decision frontmatter", () => {
    const edges = deriveEdges("decisions/2026-05-22-foo.md", {
      type: "decision", project: "superbrain", created: "2026-05-22",
    });
    expect(edges).toContainEqual({ from: "decisions/2026-05-22-foo.md", to: "projects/superbrain.md", kind: "project" });
    expect(edges).toContainEqual({ from: "decisions/2026-05-22-foo.md", to: "daily/2026-05-22.md", kind: "daily" });
  });

  it("derives related edges from frontmatter.related[]", () => {
    const edges = deriveEdges("decisions/foo.md", { type: "decision", project: "superbrain", created: "2026-05-22", related: ["decisions/bar.md", "lessons/baz"] });
    expect(edges).toContainEqual({ from: "decisions/foo.md", to: "decisions/bar.md", kind: "related" });
    expect(edges).toContainEqual({ from: "decisions/foo.md", to: "lessons/baz", kind: "related" });
  });

  it("derives supersedes edge", () => {
    const edges = deriveEdges("decisions/foo.md", { type: "decision", project: "superbrain", created: "2026-05-22", superseded_by: "decisions/bar.md" });
    expect(edges).toContainEqual({ from: "decisions/foo.md", to: "decisions/bar.md", kind: "supersedes" });
  });

  it("project=global produces no project edge", () => {
    const edges = deriveEdges("lessons/x.md", { type: "lesson", project: "global", created: "2026-05-22" });
    expect(edges.some(e => e.kind === "project")).toBe(false);
  });

  it("daily note does NOT produce a self-loop to itself", () => {
    const edges = deriveEdges("daily/2026-05-22.md", { type: "daily", date: "2026-05-22" });
    expect(edges.some(e => e.kind === "daily")).toBe(false);
  });

  it("project note does NOT produce a self-loop project edge", () => {
    const edges = deriveEdges("projects/superbrain.md", { type: "project", slug: "superbrain", project: "superbrain", created: "2026-05-22" });
    expect(edges.some(e => e.kind === "project")).toBe(false);
  });
});

describe("upsertEdges + ensureEdgesTable", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    ensureEdgesTable(db);
  });

  it("persists edges and de-duplicates by (from,to,kind)", () => {
    const edges = [
      { from: "a.md", to: "b.md", kind: "related" as const },
      { from: "a.md", to: "b.md", kind: "related" as const },  // duplicate
      { from: "a.md", to: "c.md", kind: "related" as const },
    ];
    upsertEdges(db, edges);
    const rows = db.prepare("SELECT * FROM vault_edges WHERE from_path = ? ORDER BY to_path").all("a.md") as any[];
    expect(rows.length).toBe(2);  // duplicate collapsed
  });

  it("supports both incoming and outgoing lookups", () => {
    upsertEdges(db, [{ from: "a.md", to: "b.md", kind: "related" }]);
    const out = db.prepare("SELECT * FROM vault_edges WHERE from_path = ?").all("a.md") as any[];
    const inc = db.prepare("SELECT * FROM vault_edges WHERE to_path = ?").all("b.md") as any[];
    expect(out.length).toBe(1);
    expect(inc.length).toBe(1);
  });
});
