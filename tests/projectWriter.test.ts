import { describe, it, expect } from "vitest";
import { appendDatedSection, appendDatedSectionWithArchive } from "../src/projectWriter.js";

const minimalBody = `---
type: project
slug: superbrain
created: 2026-05-19
status: active
superbrain: true
---

# SuperBrain

## What it is

A second brain.

## Status

In active development.

## Architecture

TS/Node/SQLite.

## Recent activity

### 2026-05-22

shipped Phase 1.

### 2026-05-21

shipped Phase 0.

## Gotchas

- index.db can rebuild from vault.
`;

describe("appendDatedSection", () => {
  it("inserts a new dated subsection at the top of ## Recent activity", () => {
    const out = appendDatedSection(minimalBody, "2026-05-23", "shipped Phase 4.");
    expect(out).toMatch(/## Recent activity\n\n### 2026-05-23\n\nshipped Phase 4\.\n\n### 2026-05-22/);
  });

  it("throws on duplicate date heading", () => {
    expect(() => appendDatedSection(minimalBody, "2026-05-22", "extra")).toThrow(/duplicate heading/);
  });

  it("throws when ## Recent activity section is absent", () => {
    const stripped = minimalBody.replace(/## Recent activity[\s\S]*?(?=## Gotchas)/, "");
    expect(() => appendDatedSection(stripped, "2026-05-23", "x")).toThrow(/Recent activity/);
  });
});

describe("appendDatedSectionWithArchive", () => {
  it("does not archive when under sizeCap", () => {
    const r = appendDatedSectionWithArchive(minimalBody, "2026-05-23", "small.", { sizeCap: 20480 });
    expect(r.archived).toEqual([]);
  });

  it("archives oldest dated subsection when over sizeCap", () => {
    // Inflate the body so adding a new dated section pushes it over 1KB.
    const bigContent = "x".repeat(800);
    const bloated = minimalBody.replace("shipped Phase 0.", bigContent);
    const r = appendDatedSectionWithArchive(bloated, "2026-05-23", "new entry", { sizeCap: 1024 });
    expect(r.archived.length).toBeGreaterThan(0);
    expect(r.archived[0].date).toMatch(/^2026-05-/);  // the oldest one was removed
    expect(Buffer.byteLength(r.body, "utf8")).toBeLessThanOrEqual(1024 + 200); // approximate (newline/whitespace tolerance)
  });

  it("preserves '## Gotchas' and other non-Recent-activity sections during archiving", () => {
    const bigContent = "x".repeat(2000);
    const bloated = minimalBody.replace("shipped Phase 0.", bigContent);
    const r = appendDatedSectionWithArchive(bloated, "2026-05-23", "new", { sizeCap: 1024 });
    expect(r.body).toContain("## Gotchas");
  });

  it("stops archiving when no more ### subsections remain", () => {
    // Start with only ONE dated subsection. Archive it. Cannot archive further.
    const oneSub = minimalBody.replace(/### 2026-05-21\n\n[\s\S]*?(?=## Gotchas)/, "");
    const r = appendDatedSectionWithArchive(oneSub, "2026-05-23", "z".repeat(3000), { sizeCap: 100 });
    // The newly-added one or the previous 2026-05-22 may be archived — but at most TWO subsections existed at any point.
    expect(r.archived.length).toBeLessThanOrEqual(2);
    // body may still be over cap because the new content itself is huge; that's expected
  });
});
