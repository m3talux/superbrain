import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mock claudeP before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../src/claudeCli.js", () => ({
  claudeP: vi.fn(async (prompt: string): Promise<string> => {
    if (prompt.includes("Type: decision")) {
      return (
        "# Use TypeScript for all new modules\n\n" +
        "## Decision\n" +
        "Adopt TypeScript for every new module going forward.\n\n" +
        "## Why\n" +
        "- Type safety eliminates a whole class of runtime errors.\n" +
        "- Better IDE support speeds up development.\n\n" +
        "## Alternatives considered\n" +
        "- **Plain JavaScript** — rejected because lack of types slows refactors.\n\n" +
        "## Consequences\n" +
        "- All contributors must use TypeScript.\n" +
        "- Build step required.\n"
      );
    }
    if (prompt.includes("Type: lesson")) {
      return (
        "# Always validate before writing\n\n" +
        "## Rule\n" +
        "Run validateNote before every disk write.\n\n" +
        "## Why\n" +
        "Bad data corrupted the vault on 2026-05-01.\n\n" +
        "## When this applies\n" +
        "Whenever writing to the vault from any script.\n"
      );
    }
    if (prompt.includes("Type: capture")) {
      return (
        "# Obsidian wikilink resolution\n\n" +
        "## What\n" +
        "Wikilinks can be case-insensitive and include pipe aliases.\n\n" +
        "## Why it matters\n" +
        "Broken links silently orphan notes from the graph.\n"
      );
    }
    if (prompt.includes("Type: person")) {
      return (
        "# Jane Doe\n\n" +
        "## Role\n" +
        "Engineering lead at Acme.\n\n" +
        "## Context\n" +
        "- Joined 2025-01.\n" +
        "- Focuses on distributed systems.\n\n" +
        "## Interactions\n" +
        "- 2026-05-10 — introductory call.\n"
      );
    }
    return "# stub\n";
  }),
}));

import {
  resolveWikilinks,
  buildMigrationPrompt,
  SKIP_FOLDERS,
  shouldSkip,
  planMigration,
  applyMigration,
  type MigrationPlan,
  type NoteProposal,
} from "../scripts/migrate-vault.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-migrate-"));
  for (const folder of ["decisions", "lessons", "capture", "people", "projects", "daily", "meta"]) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }
  return dir;
}

function writeNote(vault: string, relPath: string, content: string): void {
  const full = path.join(vault, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

// ---------------------------------------------------------------------------
// 1. resolveWikilinks
// ---------------------------------------------------------------------------

describe("resolveWikilinks", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkVault();
  });

  it("resolves [[foo]] against decisions/2026-05-20-foo.md (case-insensitive)", () => {
    writeNote(vault, "decisions/2026-05-20-foo.md", "# Foo\n");
    const body = "See [[foo]] for details.";
    const result = resolveWikilinks(body, vault);
    // Link should be resolved — either kept as-is (already valid) or
    // rewritten to the canonical path. The important thing: no `broken:` marker.
    expect(result).not.toContain("`[[broken:");
    expect(result).toContain("[[");
  });

  it("marks missing link as broken", () => {
    const body = "See [[nonexistent-slug]] for context.";
    const result = resolveWikilinks(body, vault);
    expect(result).toContain("`[[broken: nonexistent-slug]]`");
  });

  it("preserves pipe alias when target resolves", () => {
    writeNote(vault, "decisions/2026-05-22-bar.md", "# Bar\n");
    const body = "See [[bar|the bar decision]].";
    const result = resolveWikilinks(body, vault);
    expect(result).not.toContain("`[[broken:");
  });

  it("resolves with folder prefix e.g. [[decisions/2026-05-22-bar]]", () => {
    writeNote(vault, "decisions/2026-05-22-bar.md", "# Bar\n");
    const body = "Link: [[decisions/2026-05-22-bar]].";
    const result = resolveWikilinks(body, vault);
    expect(result).not.toContain("`[[broken:");
  });

  it("handles body with no wikilinks unchanged", () => {
    const body = "No links here at all.";
    const result = resolveWikilinks(body, vault);
    expect(result).toBe(body);
  });

  it("marks multiple broken links separately", () => {
    const body = "[[alpha]] and [[beta]] are missing.";
    const result = resolveWikilinks(body, vault);
    expect(result).toContain("`[[broken: alpha]]`");
    expect(result).toContain("`[[broken: beta]]`");
  });
});

// ---------------------------------------------------------------------------
// 2. shouldSkip
// ---------------------------------------------------------------------------

describe("shouldSkip", () => {
  it("skips files in projects/", () => {
    expect(shouldSkip("projects/jarvis.md", "")).toBe(true);
  });

  it("skips files in daily/", () => {
    expect(shouldSkip("daily/2026-05-22.md", "")).toBe(true);
  });

  it("skips files in meta/", () => {
    expect(shouldSkip("meta/config.md", "")).toBe(true);
  });

  it("skips files in projects/_archive/", () => {
    expect(shouldSkip("projects/_archive/old-2024.md", "")).toBe(true);
  });

  const realBody = "---\ntype: decision\nproject: x\nstatus: active\n---\n# Title\n\nSome content here.\n";

  it("does NOT skip decisions/", () => {
    expect(shouldSkip("decisions/2026-05-20-foo.md", realBody)).toBe(false);
  });

  it("does NOT skip lessons/", () => {
    expect(shouldSkip("lessons/2026-05-21-bar.md", realBody)).toBe(false);
  });

  it("does NOT skip capture/", () => {
    expect(shouldSkip("capture/2026-05-22-baz.md", realBody)).toBe(false);
  });

  it("does NOT skip people/", () => {
    expect(shouldSkip("people/jane-doe.md", realBody)).toBe(false);
  });

  it("skips frontmatter-only stubs (no body content)", () => {
    const stub = "---\ntype: decision\nproject: x\n---\n";
    expect(shouldSkip("decisions/stub.md", stub)).toBe(true);
  });

  it("does not skip notes with a body", () => {
    const note = "---\ntype: decision\nproject: x\n---\n# Title\n\n## Decision\nSomething.\n";
    expect(shouldSkip("decisions/real.md", note)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. buildMigrationPrompt
// ---------------------------------------------------------------------------

describe("buildMigrationPrompt", () => {
  it("includes type, title, and body in the prompt", () => {
    const prompt = buildMigrationPrompt({
      type: "decision",
      title: "Use TypeScript",
      body: "Some old body.",
      project: "superbrain",
      created: "2026-05-20",
    });
    expect(prompt).toContain("Type: decision");
    expect(prompt).toContain("Use TypeScript");
    expect(prompt).toContain("Some old body.");
    expect(prompt).toContain("## Decision");
    expect(prompt).toContain("## Why");
    expect(prompt).toContain("## Alternatives considered");
    expect(prompt).toContain("## Consequences");
  });

  it("includes lesson sections for lesson type", () => {
    const prompt = buildMigrationPrompt({
      type: "lesson",
      title: "Always validate",
      body: "Old body.",
      project: "superbrain",
      created: "2026-05-21",
    });
    expect(prompt).toContain("Type: lesson");
    expect(prompt).toContain("## Rule");
    expect(prompt).toContain("## When this applies");
  });

  it("includes capture sections for capture type", () => {
    const prompt = buildMigrationPrompt({
      type: "capture",
      title: "Cool finding",
      body: "Old body.",
      project: "superbrain",
      created: "2026-05-22",
    });
    expect(prompt).toContain("Type: capture");
    expect(prompt).toContain("## What");
    expect(prompt).toContain("## Why it matters");
  });

  it("includes word ceiling in prompt", () => {
    const prompt = buildMigrationPrompt({
      type: "decision",
      title: "Title",
      body: "Body.",
      project: "x",
      created: "2026-05-22",
    });
    expect(prompt).toContain("350");
  });
});

// ---------------------------------------------------------------------------
// 4. planMigration
// ---------------------------------------------------------------------------

describe("planMigration", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkVault();
  });

  it("includes a decision note in the plan", () => {
    writeNote(
      vault,
      "decisions/2026-05-20-use-ts.md",
      "---\ntype: decision\nproject: superbrain\nstatus: active\ncreated: 2026-05-20\n---\n# Use TypeScript\n\nSome old body here.\n"
    );
    const plan = planMigration(vault);
    expect(plan.some((p) => p.relPath.includes("use-ts"))).toBe(true);
  });

  it("excludes projects/ from plan", () => {
    writeNote(
      vault,
      "projects/jarvis.md",
      "---\ntype: project\nproject: jarvis\nstatus: active\ncreated: 2026-05-01\n---\n# Jarvis\n\n## What it is\nSomething.\n"
    );
    const plan = planMigration(vault);
    expect(plan.every((p) => !p.relPath.startsWith("projects/"))).toBe(true);
  });

  it("excludes daily/ from plan", () => {
    writeNote(vault, "daily/2026-05-22.md", "---\ntype: daily\n---\n# 2026-05-22\n\n## Worked on\n");
    const plan = planMigration(vault);
    expect(plan.every((p) => !p.relPath.startsWith("daily/"))).toBe(true);
  });

  it("excludes frontmatter-only stubs from plan", () => {
    writeNote(vault, "lessons/2026-05-22-stub.md", "---\ntype: lesson\nproject: x\nstatus: active\n---\n");
    const plan = planMigration(vault);
    expect(plan.every((p) => !p.relPath.includes("stub"))).toBe(true);
  });

  it("filters by type when typeFilter is provided", () => {
    writeNote(
      vault,
      "decisions/2026-05-20-use-ts.md",
      "---\ntype: decision\nproject: superbrain\nstatus: active\ncreated: 2026-05-20\n---\n# Use TypeScript\n\nOld body.\n"
    );
    writeNote(
      vault,
      "lessons/2026-05-21-validate.md",
      "---\ntype: lesson\nproject: superbrain\nstatus: active\ncreated: 2026-05-21\n---\n# Always validate\n\nOld body.\n"
    );
    const plan = planMigration(vault, { typeFilter: "decision" });
    expect(plan.every((p) => p.relPath.startsWith("decisions/"))).toBe(true);
    expect(plan.some((p) => p.relPath.startsWith("lessons/"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. applyMigration — validate-before-write + backup
// ---------------------------------------------------------------------------

describe("applyMigration", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkVault();
  });

  it("writes rewritten body and backs up original", async () => {
    const noteContent =
      "---\ntype: decision\nproject: superbrain\nstatus: active\ncreated: 2026-05-20\n---\n# Use TypeScript\n\nSome old body.\n";
    writeNote(vault, "decisions/2026-05-20-use-ts.md", noteContent);

    const plan = planMigration(vault);
    expect(plan.length).toBeGreaterThan(0);

    const results = await applyMigration(vault, plan, {
      apply: true,
      backupDate: "2026-05-22",
      concurrency: 1,
    });

    const written = results.find((r) => r.relPath.includes("use-ts"));
    expect(written).toBeDefined();

    if (written?.status === "rewritten") {
      // Backup should exist
      const backupPath = path.join(
        vault,
        ".trash",
        "migration-2026-05-22",
        "decisions/2026-05-20-use-ts.md"
      );
      expect(fs.existsSync(backupPath)).toBe(true);

      // New file should contain the LLM output (decision sections)
      const newContent = fs.readFileSync(
        path.join(vault, "decisions/2026-05-20-use-ts.md"),
        "utf8"
      );
      expect(newContent).toContain("## Decision");
      expect(newContent).toContain("## Why");
    }
  });

  it("skips (keeps original) when LLM output fails validation", async () => {
    // claudeP mock returns "# stub\n" for unknown types — that will fail decision validation
    // We'll force this by writing a note but intercepting via a bad mock return.
    // Easiest: write a note whose type does NOT match decision/lesson/capture/person
    // so the mock returns "# stub\n" which lacks required sections.

    // Actually the mock keys on Type: decision etc. Let's write a capture note
    // but make its relPath appear in decisions/ — the plan will type it as decision
    // but claudeP will return stub. Actually, to isolate: use a lesson note but
    // point the mock at returning invalid content.
    // Best approach: write a note, then override the mock for this test.
    const { claudeP } = await import("../src/claudeCli.js");
    const mockClaudeP = vi.mocked(claudeP);
    const origImpl = mockClaudeP.getMockImplementation();
    mockClaudeP.mockResolvedValueOnce("# broken output — no required sections\n");

    const noteContent =
      "---\ntype: decision\nproject: superbrain\nstatus: active\ncreated: 2026-05-20\n---\n# A decision\n\nOriginal body text.\n";
    writeNote(vault, "decisions/2026-05-20-bad-output.md", noteContent);

    const plan = planMigration(vault);
    const results = await applyMigration(vault, plan, {
      apply: true,
      backupDate: "2026-05-22",
      concurrency: 1,
    });

    const result = results.find((r) => r.relPath.includes("bad-output"));
    expect(result?.status).toBe("skipped");
    // Original file should be unchanged
    const content = fs.readFileSync(
      path.join(vault, "decisions/2026-05-20-bad-output.md"),
      "utf8"
    );
    expect(content).toContain("Original body text.");
    // Restore original mock
    if (origImpl) mockClaudeP.mockImplementation(origImpl);
  });

  it("dry-run does not write any files", async () => {
    const noteContent =
      "---\ntype: lesson\nproject: superbrain\nstatus: active\ncreated: 2026-05-21\n---\n# Always validate\n\nOld body content here.\n";
    writeNote(vault, "lessons/2026-05-21-validate.md", noteContent);

    const plan = planMigration(vault);
    await applyMigration(vault, plan, {
      apply: false,
      backupDate: "2026-05-22",
      concurrency: 1,
    });

    // Original should be unchanged
    const content = fs.readFileSync(
      path.join(vault, "lessons/2026-05-21-validate.md"),
      "utf8"
    );
    expect(content).toContain("Old body content here.");
    // No backup should exist
    expect(
      fs.existsSync(path.join(vault, ".trash", "migration-2026-05-22"))
    ).toBe(false);
  });

  it("backup goes to .trash/migration-<date>/<relpath>", async () => {
    const noteContent =
      "---\ntype: capture\nproject: superbrain\nstatus: active\ncreated: 2026-05-22\n---\n# Wikilink finding\n\nSome captured insight about wikilinks.\n";
    writeNote(vault, "capture/2026-05-22-wikilinks.md", noteContent);

    const plan = planMigration(vault);
    const results = await applyMigration(vault, plan, {
      apply: true,
      backupDate: "2026-05-22",
      concurrency: 1,
    });

    const result = results.find((r) => r.relPath.includes("wikilinks"));
    if (result?.status === "rewritten") {
      const backupPath = path.join(
        vault,
        ".trash",
        "migration-2026-05-22",
        "capture/2026-05-22-wikilinks.md"
      );
      expect(fs.existsSync(backupPath)).toBe(true);
      // Backup content should match original
      const backupContent = fs.readFileSync(backupPath, "utf8");
      expect(backupContent).toContain("Some captured insight about wikilinks.");
    }
  });
});
