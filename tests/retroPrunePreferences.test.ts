import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parsePreferences, classify, demoteLessonFilename } from "../scripts/retro-prune-preferences.js";

// --- parsePreferences ---

const FIXTURE_BULLETS = `---
type: preference
created: '2026-01-01'
---
Durable opinions.

## Code style

- Never push directly to main.
- Always sort imports alphabetically.

## Tools

- For inspecting live pages, prefer Playwright.
`;

const FIXTURE_HEADINGS = `---
type: preference
---

## Never push directly to main
Some body text that is part of the heading entry.

## For alpha-proj: use the event-sourcing pattern
Body.
`;

const FIXTURE_MIXED = `---
type: preference
---
Preamble paragraph.

## Code style

- Never add comment blocks before every method.
- I learned that gray-matter quotes dates automatically.
- For alpha-proj: use the event-sourcing pattern.

## Version control

- Never add a Co-Authored-By trailer.
`;

describe("parsePreferences", () => {
  it("extracts bullet entries from ## Category + - item format", () => {
    const entries = parsePreferences(FIXTURE_BULLETS);
    expect(entries).toHaveLength(3);
    expect(entries[0].text).toContain("Never push directly to main");
    expect(entries[1].text).toContain("Always sort imports");
    expect(entries[2].text).toContain("prefer Playwright");
  });

  it("skips frontmatter and paragraph preambles", () => {
    const entries = parsePreferences(FIXTURE_BULLETS);
    expect(entries.every(e => !e.text.includes("Durable opinions"))).toBe(true);
  });

  it("handles ## heading-as-entry format (no category bullets)", () => {
    const entries = parsePreferences(FIXTURE_HEADINGS);
    // Both headings are entries (no bullet children)
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.some(e => e.text.includes("Never push directly to main"))).toBe(true);
    expect(entries.some(e => e.text.includes("For alpha-proj"))).toBe(true);
  });

  it("extracts source context (line or category) for each entry", () => {
    const entries = parsePreferences(FIXTURE_BULLETS);
    expect(entries.every(e => typeof e.source === "string" && e.source.length > 0)).toBe(true);
  });

  it("handles mixed format gracefully", () => {
    const entries = parsePreferences(FIXTURE_MIXED);
    expect(entries.length).toBeGreaterThanOrEqual(4);
  });
});

// --- classify ---

describe("classify", () => {
  it("keeps an imperative short rule with 'Never'", () => {
    expect(classify("Never push directly to main").verdict).toBe("keep");
  });

  it("keeps an imperative rule with 'Always'", () => {
    expect(classify("Always sort imports alphabetically").verdict).toBe("keep");
  });

  it("keeps rules starting with 'prefer'", () => {
    expect(classify("Prefer hexagonal architecture for backend services").verdict).toBe("keep");
  });

  it("keeps rules starting with 'avoid'", () => {
    expect(classify("Avoid over-engineering small CLIs").verdict).toBe("keep");
  });

  it("keeps rules starting with \"don't\"", () => {
    expect(classify("Don't add multi-line comment blocks before every method").verdict).toBe("keep");
  });

  it("keeps rules starting with 'use'", () => {
    expect(classify("Use the simpler approach whenever possible").verdict).toBe("keep");
  });

  it("demotes-lesson a past-tense observation", () => {
    expect(classify("I learned that gray-matter quotes dates automatically").verdict).toBe("demote-lesson");
  });

  it("demotes-lesson 'we got burned' narrative", () => {
    expect(classify("We got burned by switching to a layered arch mid-project").verdict).toBe("demote-lesson");
  });

  it("demotes-project a for-slug scoped entry", () => {
    const result = classify("For alpha-proj: use the event-sourcing pattern");
    expect(result.verdict).toBe("demote-project");
    expect(result.projectSlug).toBe("alpha-proj");
  });

  it("demotes-project case-insensitively", () => {
    const result = classify("for alpha-proj: prefer TypeScript");
    expect(result.verdict).toBe("demote-project");
    expect(result.projectSlug).toBe("alpha-proj");
  });

  it("keeps a long imperative rule (no length cap for imperatives)", () => {
    // Real vault preferences are long — we don't demote imperatives for length.
    const longText = "Always " + "x ".repeat(100); // well over 200 chars
    expect(classify(longText).verdict).toBe("keep");
  });

  it("is conservative — keeps when uncertain", () => {
    // A sentence that is imperative but might be borderline
    expect(classify("Default to no comments in code").verdict).toBe("keep");
  });
});

// --- demoteLessonFilename ---

describe("demoteLessonFilename", () => {
  it("produces a kebab-case filename with the date prefix", () => {
    const result = demoteLessonFilename("I learned that gray-matter quotes dates", "2026-05-22");
    expect(result).toMatch(/^2026-05-22-/);
    expect(result).toMatch(/\.md$/);
  });

  it("strips non-alphanumeric characters", () => {
    const result = demoteLessonFilename("I learned: that gray-matter quotes dates!", "2026-05-22");
    expect(result).not.toMatch(/[^a-z0-9\-./]/);
  });

  it("truncates slug to a reasonable length (≤60 chars total before .md)", () => {
    const longText = "I learned " + "word ".repeat(30);
    const result = demoteLessonFilename(longText, "2026-05-22");
    expect(result.replace(".md", "").length).toBeLessThanOrEqual(70);
  });

  it("collapses multiple dashes", () => {
    const result = demoteLessonFilename("I learned --- something", "2026-05-22");
    expect(result).not.toContain("--");
  });
});

// ---------------------------------------------------------------------------
// Extended tests: heading-preserving rewrite, core emission, idempotency
// ---------------------------------------------------------------------------

const MIXED_WITH_HEADINGS = `---
type: preference
created: '2026-01-01'
superbrain: true
---
Durable opinions.

## Code style

- Never push directly to main.
- For alpha-proj: use the event-sourcing pattern.
- Always sort imports alphabetically.

## Tools

- Prefer Playwright for browser testing.
- For test-svc: use the internal test harness.

## Version control

- I learned that rebasing is cleaner than merging.
`;

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-retro-"));
  fs.mkdirSync(path.join(TMP, "meta"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "projects"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "lessons"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function runRetroPrune(vaultDir: string, extraArgs: string[] = []): string {
  return execFileSync("npx", ["tsx", "scripts/retro-prune-preferences.ts", vaultDir, ...extraArgs], {
    encoding: "utf8",
    timeout: 30000,
    cwd: path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), "..")),
  });
}

describe("retro-prune-preferences — extended: heading-preserving rewrite", () => {
  it("preserves ## Category headings for kept entries", () => {
    fs.writeFileSync(path.join(TMP, "meta", "preferences.md"), MIXED_WITH_HEADINGS);
    runRetroPrune(TMP, ["--apply"]);
    const result = fs.readFileSync(path.join(TMP, "meta", "preferences.md"), "utf8");
    // Kept entries retain their category headings
    expect(result).toContain("## Code style");
    expect(result).toContain("Never push directly to main");
    expect(result).toContain("Always sort imports alphabetically");
  });

  it("drops empty ## Category sections after all bullets are demoted", () => {
    const allProjectDoc = `---
type: preference
created: '2026-01-01'
superbrain: true
---

## Project-specific rules

- For alpha-proj: use the event-sourcing pattern.
- For test-svc: use the internal test harness.

## Universal rules

- Never push directly to main.
`;
    fs.writeFileSync(path.join(TMP, "meta", "preferences.md"), allProjectDoc);
    runRetroPrune(TMP, ["--apply"]);
    const result = fs.readFileSync(path.join(TMP, "meta", "preferences.md"), "utf8");
    expect(result).not.toContain("## Project-specific rules");
    expect(result).toContain("## Universal rules");
    expect(result).toContain("Never push directly to main");
  });

  it("routes demoted project rules to projects/<slug>.md under ## Preferences", () => {
    fs.writeFileSync(path.join(TMP, "meta", "preferences.md"), MIXED_WITH_HEADINGS);
    runRetroPrune(TMP, ["--apply"]);
    const projectNote = path.join(TMP, "projects", "alpha-proj.md");
    expect(fs.existsSync(projectNote)).toBe(true);
    const content = fs.readFileSync(projectNote, "utf8");
    expect(content).toContain("event-sourcing pattern");
    // Should use ## Preferences, not ## Gotcha
    expect(content).toContain("## Preferences");
    expect(content).not.toContain("## Gotcha");
  });
});

describe("retro-prune-preferences — extended: core emission", () => {
  it("emits preferences-core.md during --apply", () => {
    fs.writeFileSync(path.join(TMP, "meta", "preferences.md"), MIXED_WITH_HEADINGS);
    runRetroPrune(TMP, ["--apply"]);
    const corePath = path.join(TMP, "meta", "preferences-core.md");
    expect(fs.existsSync(corePath)).toBe(true);
    const core = fs.readFileSync(corePath, "utf8");
    // Must contain imperative-prefix lines
    expect(core).toContain("Never push directly to main");
  });

  it("includes a CORE EMISSION PREVIEW section in dry-run output", () => {
    fs.writeFileSync(path.join(TMP, "meta", "preferences.md"), MIXED_WITH_HEADINGS);
    const output = runRetroPrune(TMP);
    expect(output).toContain("CORE EMISSION PREVIEW");
  });
});

describe("retro-prune-preferences — extended: idempotency", () => {
  it("is idempotent when run twice on an already-migrated vault", () => {
    fs.writeFileSync(path.join(TMP, "meta", "preferences.md"), MIXED_WITH_HEADINGS);
    // First run
    runRetroPrune(TMP, ["--apply"]);
    const firstPrefs = fs.readFileSync(path.join(TMP, "meta", "preferences.md"), "utf8");
    const firstCore = fs.readFileSync(path.join(TMP, "meta", "preferences-core.md"), "utf8");

    // Second run: preferences-core.md already exists and preferences.md is already pruned
    const secondOutput = runRetroPrune(TMP, ["--apply"]);
    const secondPrefs = fs.readFileSync(path.join(TMP, "meta", "preferences.md"), "utf8");
    const secondCore = fs.readFileSync(path.join(TMP, "meta", "preferences-core.md"), "utf8");

    // The docs must be stable across runs
    expect(secondPrefs).toBe(firstPrefs);
    expect(secondCore).toBe(firstCore);
    // Should indicate already-migrated
    expect(secondOutput).toContain("already migrated");
  });
});
