import { describe, it, expect } from "vitest";
import { route } from "../src/router.js";
import { classify } from "../src/classification.js";

describe("router → classify roundtrip post-migration", () => {
  it("a structured decision item passes classify()", () => {
    const r = route({
      kind: "decision",
      title: "Use hybrid recall",
      date: "2026-05-22",
      links: [],
      project: "superbrain",
      decision: "Use BM25 + vector RRF.",
      why: "BM25 alone misses semantic matches and vector alone is noisy.",
      alternatives: "- **BM25 only** — no semantic recall.\n- **Vector only** — noisy at low signal-to-noise.",
      consequences: "Index doubles in size. Fusion logic adds complexity.",
    });
    // Synthesize full file: serialize frontmatter + body the way distillRun would
    const body = `---\n` +
      Object.entries(r.frontmatter).filter(([,v]) => v !== undefined).map(([k,v]) => `${k}: ${v}`).join("\n") +
      `\n---\n\n` + r.body + `\n`;
    const result = classify({ proposedType: "decision", title: "Use hybrid recall", body });
    if (!result.accepted) {
      throw new Error(`Expected acceptance, got: ${result.reason}`);
    }
    expect(result.accepted).toBe(true);
  });

  it("a structured lesson item passes classify()", () => {
    const r = route({
      kind: "lesson",
      title: "Always sort imports",
      date: "2026-05-22",
      links: [],
      project: "superbrain",
      rule: "Always sort import statements alphabetically by module path.",
      why: "User pushback on 2026-05-22 — non-deterministic ordering causes git diff noise.",
      whenApplies: "When writing any TypeScript or JavaScript file.",
    });
    const body = `---\n` +
      Object.entries(r.frontmatter).filter(([,v]) => v !== undefined).map(([k,v]) => `${k}: ${v}`).join("\n") +
      `\nproject: superbrain\n---\n\n` + r.body + `\n`;
    const result = classify({ proposedType: "lesson", title: "Always sort imports", body });
    if (!result.accepted) throw new Error(`Expected acceptance, got: ${result.reason}`);
    expect(result.accepted).toBe(true);
  });
});
