import { describe, it, expect } from "vitest";
import { renderNote, validateNote, NoteType } from "../src/templates";

// ---------------------------------------------------------------------------
// Happy-path: renderNote produces required sections for each type
// ---------------------------------------------------------------------------

describe("renderNote — required sections present", () => {
  const fm = { type: "decision", created: "2026-05-22", project: "superbrain", superbrain: true };

  it("decision contains all required sections", () => {
    const body = renderNote("decision", {
      frontmatter: { ...fm, type: "decision", status: "active" },
      title: "Use SQLite for index",
    });
    expect(body).toContain("## Decision");
    expect(body).toContain("## Why");
    expect(body).toContain("## Alternatives considered");
    expect(body).toContain("## Consequences");
  });

  it("lesson contains all required sections", () => {
    const body = renderNote("lesson", {
      frontmatter: { ...fm, type: "lesson", trigger: "pushback" },
      title: "Always verify the live data dir",
    });
    expect(body).toContain("## Rule");
    expect(body).toContain("## Why");
    expect(body).toContain("## When this applies");
  });

  it("capture contains all required sections", () => {
    const body = renderNote("capture", {
      frontmatter: { ...fm, type: "capture", kind: "finding" },
      title: "SQLite WAL mode gotcha",
    });
    expect(body).toContain("## What");
    expect(body).toContain("## Why it matters");
  });

  it("project contains all required sections", () => {
    const body = renderNote("project", {
      frontmatter: { type: "project", slug: "superbrain", created: "2026-05-19", last_touched: "2026-05-22", status: "active", superbrain: true },
      title: "SuperBrain",
    });
    expect(body).toContain("## What it is");
    expect(body).toContain("## Status");
    expect(body).toContain("## Architecture");
    expect(body).toContain("## Recent activity");
    expect(body).toContain("## Gotchas");
  });

  it("daily contains all required sections", () => {
    const body = renderNote("daily", {
      frontmatter: { type: "daily", date: "2026-05-22", superbrain: true },
      title: "2026-05-22",
    });
    expect(body).toContain("## Worked on");
    expect(body).toContain("## Decisions");
    expect(body).toContain("## Lessons");
    expect(body).toContain("## Captures");
    expect(body).toContain("## Open threads");
  });

  it("person contains all required sections", () => {
    const body = renderNote("person", {
      frontmatter: { type: "person", created: "2026-05-22", role: "Engineer", superbrain: true },
      title: "Jane Doe",
    });
    expect(body).toContain("## Role");
    expect(body).toContain("## Context");
    expect(body).toContain("## Interactions");
  });
});

// ---------------------------------------------------------------------------
// Rejection: missing required section
// ---------------------------------------------------------------------------

describe("validateNote — rejects missing required section", () => {
  it("decision: missing ## Alternatives considered", () => {
    const body = `# Use SQLite\n\n## Decision\ntext.\n\n## Why\n- reason.\n\n## Consequences\n- result.\n`;
    const r = validateNote("decision", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("## Alternatives considered"))).toBe(true);
  });

  it("lesson: missing ## When this applies", () => {
    const body = `# Rule title\n\n## Rule\nOne sentence.\n\n## Why\nReason.\n`;
    const r = validateNote("lesson", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("## When this applies"))).toBe(true);
  });

  it("capture: missing ## Why it matters", () => {
    const body = `# Quick finding\n\n## What\nSome content.\n`;
    const r = validateNote("capture", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("## Why it matters"))).toBe(true);
  });

  it("project: missing ## Gotchas", () => {
    const body = `# MyProject\n\n## What it is\nDesc.\n\n## Status\nActive.\n\n## Architecture\nBullets.\n\n## Recent activity\n### 2026-05-22\nWork.\n`;
    const r = validateNote("project", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("## Gotchas"))).toBe(true);
  });

  it("daily: missing ## Open threads", () => {
    const body = `# 2026-05-22\n\n## Worked on\n- [[projects/foo]] — stuff\n\n## Decisions\n- [[decisions/bar]] — title\n\n## Lessons\n- [[lessons/baz]] — rule\n\n## Captures\n- [[capture/qux]]\n`;
    const r = validateNote("daily", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("## Open threads"))).toBe(true);
  });

  it("person: missing ## Context", () => {
    const body = `# Jane Doe\n\n## Role\nEngineer.\n\n## Interactions\n- 2026-05-22 — met.\n`;
    const r = validateNote("person", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("## Context"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Type-specific rejection rules
// ---------------------------------------------------------------------------

describe("validateNote — decision: alternatives bullet format", () => {
  const base = `# Title\n\n## Decision\ntext.\n\n## Why\n- reason.\n\n## Alternatives considered\n`;
  const tail = `\n## Consequences\n- result.\n`;

  it("rejects when alternatives missing bold-em-dash format", () => {
    const body = base + `- Option A: rejected for reasons.\n` + tail;
    const r = validateNote("decision", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("Alternatives considered"))).toBe(true);
  });

  it("accepts correct '- **Name** — reason' bullet", () => {
    const body = base + `- **Option A** — rejected because too slow.\n` + tail;
    const r = validateNote("decision", body);
    // Should not have the alternatives error (may have none at all)
    expect(r.errors.some(e => e.includes("Alternatives considered must contain"))).toBe(false);
  });
});

describe("validateNote — decision: word count ceiling (350)", () => {
  it("rejects when body exceeds 350 words", () => {
    const filler = "word ".repeat(360);
    const body = `# Title\n\n## Decision\n${filler}\n\n## Why\n- r.\n\n## Alternatives considered\n- **A** — b.\n\n## Consequences\n- c.\n`;
    const r = validateNote("decision", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("word count"))).toBe(true);
  });

  it("accepts body well under 350 words", () => {
    const filler = "word ".repeat(100);
    const body = `# Title\n\n## Decision\n${filler}\n\n## Why\n- r.\n\n## Alternatives considered\n- **A** — b.\n\n## Consequences\n- c.\n`;
    const r = validateNote("decision", body);
    expect(r.errors.some(e => e.includes("word count"))).toBe(false);
  });
});

describe("validateNote — capture: title rules", () => {
  const sections = `\n\n## What\nContent.\n\n## Why it matters\nImportant.\n`;

  it("rejects title longer than 8 words", () => {
    const body = `# This is a very long sentence title that is too long\n` + sections;
    const r = validateNote("capture", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("title"))).toBe(true);
  });

  it("rejects title ending with period", () => {
    const body = `# Short title.\n` + sections;
    const r = validateNote("capture", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("title"))).toBe(true);
  });

  it("accepts valid short title without period", () => {
    const body = `# SQLite WAL mode gotcha\n` + sections;
    const r = validateNote("capture", body);
    expect(r.errors.some(e => e.includes("title"))).toBe(false);
  });
});

describe("validateNote — daily: non-wikilink bullets", () => {
  const validTail = `\n## Captures\n- [[capture/foo]]\n\n## Open threads\n- free text here\n`;

  it("rejects prose bullet under ## Worked on", () => {
    const body = `# 2026-05-22\n\n## Worked on\n- did some work on superbrain\n\n## Decisions\n- [[decisions/foo]] — title\n\n## Lessons\n- [[lessons/bar]] — rule\n` + validTail;
    const r = validateNote("daily", body);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("Worked on"))).toBe(true);
  });

  it("accepts wikilink bullets under ## Worked on", () => {
    const body = `# 2026-05-22\n\n## Worked on\n- [[projects/superbrain]] — shipped templates\n\n## Decisions\n- [[decisions/foo]] — title\n\n## Lessons\n- [[lessons/bar]] — rule\n` + validTail;
    const r = validateNote("daily", body);
    expect(r.errors.some(e => e.includes("Worked on"))).toBe(false);
  });

  it("allows free text under ## Open threads", () => {
    const body = `# 2026-05-22\n\n## Worked on\n- [[projects/sb]] — work\n\n## Decisions\n- [[decisions/foo]] — title\n\n## Lessons\n- [[lessons/bar]] — rule\n\n## Captures\n- [[capture/baz]]\n\n## Open threads\n- some free text here without wikilink\n`;
    const r = validateNote("daily", body);
    expect(r.errors.some(e => e.includes("Open threads"))).toBe(false);
  });
});
