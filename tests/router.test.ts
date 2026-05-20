import { describe, it, expect } from "vitest";
import { route } from "../src/router";

describe("router", () => {
  it("routes a decision to dated decisions file", () => {
    const r = route({ kind: "decision", title: "Use sqlite-vec", body: "because", date: "2026-05-19", links: ["SuperBrain"] });
    expect(r.relPath).toBe("decisions/2026-05-19-use-sqlite-vec.md");
    expect(r.frontmatter.type).toBe("decision");
    expect(r.body).toContain("[[SuperBrain]]");
  });
  it("assembles structured ADR sections when the distiller fills them", () => {
    const r = route({
      kind: "decision",
      title: "Pin distiller model to Sonnet 4.6",
      date: "2026-05-19",
      context: "Legacy scribe burned Opus quota in hours.",
      decision: "Hardcode --model claude-sonnet-4-6; no env override.",
      rationale: "Sonnet 4.6 is ~1/5 the cost for comparable summarization quality.",
      consequences: "Users wanting more must set ANTHROPIC_API_KEY.",
      implementation: "src/distillRun.ts:distillModel() returns the literal.",
      links: ["projects/superbrain"],
    });
    expect(r.body).toContain("## Context");
    expect(r.body).toContain("## Decision");
    expect(r.body).toContain("## Rationale");
    expect(r.body).toContain("## Consequences");
    expect(r.body).toContain("## Implementation");
    expect(r.body).toContain("[[projects/superbrain]]");
  });
  it("omits empty sections in the structured ADR template", () => {
    const r = route({
      kind: "decision",
      title: "X",
      date: "2026-05-19",
      context: "ctx",
      decision: "d",
      links: [],
    });
    expect(r.body).toContain("## Context");
    expect(r.body).toContain("## Decision");
    expect(r.body).not.toContain("## Rationale");
    expect(r.body).not.toContain("## Consequences");
    expect(r.body).not.toContain("## Implementation");
  });
  it("assembles structured lesson sections (Rule / Why / When)", () => {
    const r = route({
      kind: "lesson",
      title: "Verify the live data dir",
      date: "2026-05-20",
      rule: "Resolve CLAUDE_PLUGIN_DATA at hook execution time.",
      why: "A full misdiagnosis was produced after inspecting the source's fallback path.",
      whenApplies: "Any time a Claude Code plugin appears to not be writing data.",
      links: ["projects/superbrain"],
    });
    expect(r.relPath).toBe("lessons/2026-05-20-verify-the-live-data-dir.md");
    expect(r.body).toContain("## Rule");
    expect(r.body).toContain("## Why");
    expect(r.body).toContain("## When this applies");
  });
  it("falls back to legacy body when structured lesson fields absent (back-compat)", () => {
    const r = route({ kind: "lesson", title: "L", body: "incident details", date: "2026-05-19", links: [], rule: "always X" });
    expect(r.body).toContain("**Why:** incident details");
    expect(r.body).toContain("**Rule:** always X");
  });
  it("assembles structured gotcha sections under the project note", () => {
    const r = route({
      kind: "gotcha",
      title: "ABI mismatch under Node 25",
      date: "2026-05-19",
      project: "superbrain",
      symptom: "Every require('better-sqlite3') crashes silently.",
      rootCause: "Node 25 ABI 141 has no published prebuild; npm ci installs source-only.",
      fix: "npm rebuild better-sqlite3 after npm ci; verify .node binding loads.",
      prevention: "depsPresent() must scan for .node files, not just the package dir.",
      links: [],
    });
    expect(r.relPath).toBe("projects/superbrain.md");
    expect(r.mode).toBe("append");
    expect(r.body).toContain("## Gotcha — ABI mismatch under Node 25");
    expect(r.body).toContain("## Symptom");
    expect(r.body).toContain("## Root cause");
    expect(r.body).toContain("## Fix");
    expect(r.body).toContain("## Prevention");
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
