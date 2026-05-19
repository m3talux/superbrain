import { describe, it, expect } from "vitest";
import { route } from "../src/router";

describe("router", () => {
  it("routes a decision to dated decisions file", () => {
    const r = route({ kind: "decision", title: "Use sqlite-vec", body: "because", date: "2026-05-19", links: ["SuperBrain"] });
    expect(r.relPath).toBe("decisions/2026-05-19-use-sqlite-vec.md");
    expect(r.frontmatter.type).toBe("decision");
    expect(r.body).toContain("[[SuperBrain]]");
  });
  it("routes a project fact to projects/<slug>.md append", () => {
    const r = route({ kind: "project_fact", project: "Super Brain", title: "deadline", body: "ship June", date: "2026-05-19", links: [] });
    expect(r.relPath).toBe("projects/super-brain.md");
    expect(r.mode).toBe("append");
  });
  it("routes a person", () => {
    expect(route({ kind: "person", person: "Jane Doe", title: "", body: "lead", date: "2026-05-19", links: [] }).relPath).toBe("people/jane-doe.md");
  });
  it("routes uncategorized to capture with triage tag", () => {
    const r = route({ kind: "capture", title: "stray idea", body: "x", date: "2026-05-19", links: [] });
    expect(r.relPath).toMatch(/^capture\/2026-05-19-stray-idea\.md$/);
    expect(r.frontmatter.tags).toContain("triage");
  });
});
