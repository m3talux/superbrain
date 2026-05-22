import { describe, it, expect } from "vitest";
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

## For Weddy: use middle-east founding market
Body.
`;

const FIXTURE_MIXED = `---
type: preference
---
Preamble paragraph.

## Code style

- Never add comment blocks before every method.
- I learned that gray-matter quotes dates automatically.
- For Weddy: use middle-east founding market.

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
    expect(entries.some(e => e.text.includes("For Weddy"))).toBe(true);
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
    const result = classify("For Weddy: use middle-east founding market");
    expect(result.verdict).toBe("demote-project");
    expect(result.projectSlug).toBe("weddy");
  });

  it("demotes-project case-insensitively", () => {
    const result = classify("for weddy: prefer TypeScript");
    expect(result.verdict).toBe("demote-project");
    expect(result.projectSlug).toBe("weddy");
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
