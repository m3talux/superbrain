import { describe, it, expect } from "vitest";
import { classify } from "../src/classification.js";

const validDecisionBody = `---
type: decision
created: 2026-05-22
project: superbrain
status: active
superbrain: true
---

# Use BM25 plus vector hybrid recall

## Decision
Use hybrid recall.

## Why
- BM25 alone misses semantic matches.

## Alternatives considered
- **BM25 only** — no semantic recall.
- **Vector only** — noisy.

## Consequences
- Index doubles in size.
`;

const validLessonBody = `---
type: lesson
created: 2026-05-22
project: superbrain
superbrain: true
---

# Always validate frontmatter before writing

## Rule
Validate frontmatter keys before writing any note to disk.

## Why
Missing keys caused silent failures in 2026-05-20.

## When this applies
Any note-write code path.
`;

const validCaptureBody = `---
type: capture
created: 2026-05-22
project: superbrain
superbrain: true
---

# Hybrid BM25 vector approach

## What
A hybrid retrieval system combining BM25 and vector search.

## Why it matters
Better recall than either alone.
`;

describe("classification", () => {
  it("accepts a valid decision", () => {
    const r = classify({ proposedType: "decision", title: "Use BM25 plus vector hybrid recall", body: validDecisionBody });
    expect(r.accepted).toBe(true);
  });

  it("reroutes 'Shipped X' decision to capture", () => {
    const body = validDecisionBody.replace("Use BM25", "Shipped");
    const r = classify({ proposedType: "decision", title: "Shipped phase 1", body });
    expect(r.accepted).toBe(false);
    expect(r.suggestedType).toBe("capture");
    expect(r.reason).toMatch(/shipped/i);
  });

  it("reroutes 'Learned X' decision to lesson", () => {
    const r = classify({ proposedType: "decision", title: "Learned about gray-matter dates", body: validDecisionBody });
    expect(r.accepted).toBe(false);
    expect(r.suggestedType).toBe("lesson");
  });

  it("reroutes 'Always X' decision to lesson", () => {
    const r = classify({ proposedType: "decision", title: "Always sort imports", body: validDecisionBody });
    expect(r.suggestedType).toBe("lesson");
  });

  it("rejects a decision missing Alternatives considered", () => {
    const body = validDecisionBody.replace(/## Alternatives considered\n[\s\S]*?## Consequences/, "## Consequences");
    const r = classify({ proposedType: "decision", title: "Use BM25", body });
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/Alternatives/);
  });

  it("rejects a decision over the 350 word ceiling", () => {
    const padded = "word ".repeat(400);
    const body = validDecisionBody.replace("Use hybrid recall.", padded);
    const r = classify({ proposedType: "decision", title: "Use hybrid", body });
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/word count/);
  });

  it("rejects when frontmatter is missing project for non-daily types", () => {
    const body = validDecisionBody.replace(/project: superbrain\n/, "");
    const r = classify({ proposedType: "decision", title: "x", body });
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/required: project/);
  });

  it("does not require project for type daily", () => {
    const body = `---
type: daily
date: 2026-05-22
superbrain: true
---

# 2026-05-22

## Worked on

## Decisions

## Lessons

## Captures

## Open threads
`;
    const r = classify({ proposedType: "daily", title: "2026-05-22", body });
    expect(r.accepted).toBe(true);
  });

  it("title-prefix reroute is case-insensitive", () => {
    const r = classify({ proposedType: "decision", title: "SHIPPED phase 1", body: validDecisionBody });
    expect(r.suggestedType).toBe("capture");
  });

  it("accepts a valid lesson", () => {
    const r = classify({ proposedType: "lesson", title: "Always validate frontmatter before writing", body: validLessonBody });
    expect(r.accepted).toBe(true);
  });

  it("rejects a lesson missing project frontmatter", () => {
    const body = validLessonBody.replace(/project: superbrain\n/, "");
    const r = classify({ proposedType: "lesson", title: "Some lesson", body });
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/required: project/);
  });

  it("accepts a valid capture", () => {
    const r = classify({ proposedType: "capture", title: "Hybrid BM25 vector approach", body: validCaptureBody });
    expect(r.accepted).toBe(true);
  });

  it("rejects a capture with a sentence title (trailing period)", () => {
    const body = validCaptureBody.replace("# Hybrid BM25 vector approach", "# Hybrid approach.");
    const r = classify({ proposedType: "capture", title: "Hybrid approach.", body });
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/title/);
  });

  it("reroutes 'Never X' decision to lesson", () => {
    const r = classify({ proposedType: "decision", title: "Never skip tests", body: validDecisionBody });
    expect(r.accepted).toBe(false);
    expect(r.suggestedType).toBe("lesson");
    expect(r.reason).toMatch(/never/i);
  });

  it("reroutes 'Released X' decision to capture", () => {
    const r = classify({ proposedType: "decision", title: "Released v0.5 to marketplace", body: validDecisionBody });
    expect(r.accepted).toBe(false);
    expect(r.suggestedType).toBe("capture");
  });
});
