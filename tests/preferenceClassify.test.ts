import { describe, it, expect } from "vitest";
import {
  classifyPreferenceScope,
  filterToUniversal,
} from "../src/preferenceClassify.js";

// ---------------------------------------------------------------------------
// classifyPreferenceScope — unit tests
// ---------------------------------------------------------------------------

// Known slugs used in tests that expect demotion
const KNOWN = new Set(["alpha-proj", "test-svc", "beta-app"]);

describe("classifyPreferenceScope — signal 1: explicit for-<slug> prefix", () => {
  it("demotes 'For alpha-proj: use the event-sourcing pattern' when slug is known (signal 1)", () => {
    const r = classifyPreferenceScope("For alpha-proj: use the event-sourcing pattern", KNOWN);
    expect(r.scope).toBe("project");
    expect(r.projectSlug).toBe("alpha-proj");
  });

  it("keeps 'For CLI tools: prefer positional args' (generic token)", () => {
    const r = classifyPreferenceScope("For CLI tools: prefer positional args", KNOWN);
    expect(r.scope).toBe("universal");
  });

  it("demotes case-insensitively: 'for test-svc: always add integration tests' when slug is known", () => {
    const r = classifyPreferenceScope("for test-svc: always add integration tests", KNOWN);
    expect(r.scope).toBe("project");
    expect(r.projectSlug).toBe("test-svc");
  });

  it("keeps 'For API: always version the endpoints' (generic API token)", () => {
    const r = classifyPreferenceScope("For API: always version the endpoints", KNOWN);
    expect(r.scope).toBe("universal");
  });

  it("keeps 'For alpha-proj: ...' when knownSlugs is empty", () => {
    const r = classifyPreferenceScope("For alpha-proj: use the event-sourcing pattern", new Set());
    expect(r.scope).toBe("universal");
  });

  it("keeps 'For alpha-proj: ...' when called with default (no knownSlugs arg)", () => {
    const r = classifyPreferenceScope("For alpha-proj: use the event-sourcing pattern");
    expect(r.scope).toBe("universal");
  });
});

describe("classifyPreferenceScope — signal 2: inline project-name mention", () => {
  it("demotes 'When working on beta-app, always add integration tests' when slug is known (signal 2)", () => {
    const r = classifyPreferenceScope("When working on beta-app, always add integration tests", KNOWN);
    expect(r.scope).toBe("project");
    expect(r.projectSlug).toBe("beta-app");
  });

  it("keeps 'When working on a new feature, always add integration tests' (no slug)", () => {
    const r = classifyPreferenceScope("When working on a new feature, always add integration tests", KNOWN);
    expect(r.scope).toBe("universal");
  });

  it("demotes 'In alpha-proj, prefer the repository pattern' when slug is known", () => {
    const r = classifyPreferenceScope("In alpha-proj, prefer the repository pattern", KNOWN);
    expect(r.scope).toBe("project");
    expect(r.projectSlug).toBe("alpha-proj");
  });

  it("keeps 'In tests, prefer explicit assertions' (generic 'tests' word)", () => {
    const r = classifyPreferenceScope("In tests, prefer explicit assertions", KNOWN);
    expect(r.scope).toBe("universal");
  });
});

describe("classifyPreferenceScope — signal 4: conditional imperatives (always universal)", () => {
  it("keeps 'When adding a new API endpoint, always write a contract test'", () => {
    const r = classifyPreferenceScope("When adding a new API endpoint, always write a contract test", KNOWN);
    expect(r.scope).toBe("universal");
  });

  it("keeps 'Before merging, always run the full test suite'", () => {
    const r = classifyPreferenceScope("Before merging, always run the full test suite", KNOWN);
    expect(r.scope).toBe("universal");
  });
});

describe("classifyPreferenceScope — signal 5: past-tense narrative (not project)", () => {
  it("returns scope='universal' for past-tense narrative (lesson, not project)", () => {
    const r = classifyPreferenceScope("I learned that shared state leads to subtle bugs", KNOWN);
    expect(r.scope).toBe("universal");
  });

  it("returns scope='universal' for 'We got burned by switching arch mid-project'", () => {
    const r = classifyPreferenceScope("We got burned by switching arch mid-project", KNOWN);
    expect(r.scope).toBe("universal");
  });
});

describe("classifyPreferenceScope — default conservative", () => {
  it("keeps an imperative-only rule with no project references", () => {
    const r = classifyPreferenceScope("Always write tests before implementation", KNOWN);
    expect(r.scope).toBe("universal");
  });

  it("keeps when uncertain / ambiguous", () => {
    const r = classifyPreferenceScope("Consider the trade-offs carefully", KNOWN);
    expect(r.scope).toBe("universal");
  });

  it("keeps a long imperative rule (no length cutoff)", () => {
    const text = "Always " + "ensure every function has explicit return types ".repeat(5);
    const r = classifyPreferenceScope(text, KNOWN);
    expect(r.scope).toBe("universal");
  });
});

// ---------------------------------------------------------------------------
// ADVERSARIAL TESTS — classifier conservatism
// All inputs must classify as 'universal' when the token is not a known slug.
// ---------------------------------------------------------------------------

describe("classifyPreferenceScope — adversarial: common-English tokens stay universal", () => {
  const EMPTY_SLUGS = new Set<string>();

  it("'In general, prefer composition over inheritance' -> universal", () => {
    expect(classifyPreferenceScope("In general, prefer composition over inheritance", EMPTY_SLUGS).scope)
      .toBe("universal");
  });

  it("'In particular, avoid global mutable state' -> universal", () => {
    expect(classifyPreferenceScope("In particular, avoid global mutable state", EMPTY_SLUGS).scope)
      .toBe("universal");
  });

  it("'In summary, keep functions small' -> universal", () => {
    expect(classifyPreferenceScope("In summary, keep functions small", EMPTY_SLUGS).scope)
      .toBe("universal");
  });

  it("'In production, always enable logging' -> universal", () => {
    expect(classifyPreferenceScope("In production, always enable logging", EMPTY_SLUGS).scope)
      .toBe("universal");
  });

  it("'In staging, use the test database' -> universal", () => {
    expect(classifyPreferenceScope("In staging, use the test database", EMPTY_SLUGS).scope)
      .toBe("universal");
  });

  it("'In review, check for security issues' -> universal", () => {
    expect(classifyPreferenceScope("In review, check for security issues", EMPTY_SLUGS).scope)
      .toBe("universal");
  });

  it("'When working on authentication, always hash passwords' -> universal", () => {
    expect(classifyPreferenceScope("When working on authentication, always hash passwords", EMPTY_SLUGS).scope)
      .toBe("universal");
  });

  it("'For event-sourcing: use an append-only log' -> universal (generic tech pattern, not a known slug)", () => {
    expect(classifyPreferenceScope("For event-sourcing: use an append-only log", EMPTY_SLUGS).scope)
      .toBe("universal");
  });

  it("same common-English tokens stay universal even when KNOWN set is non-empty", () => {
    const inputs = [
      "In general, prefer composition over inheritance",
      "In particular, avoid global mutable state",
      "In summary, keep functions small",
      "In production, always enable logging",
      "In staging, use the test database",
      "In review, check for security issues",
      "When working on authentication, always hash passwords",
    ];
    for (const text of inputs) {
      const r = classifyPreferenceScope(text, KNOWN);
      expect(r.scope, `expected '${text}' to be universal`).toBe("universal");
    }
  });

  it("a rule naming a KNOWN existing project slug DOES demote", () => {
    const withKnown = new Set(["my-service"]);
    const r = classifyPreferenceScope("For my-service: always add request tracing", withKnown);
    expect(r.scope).toBe("project");
    expect(r.projectSlug).toBe("my-service");
  });

  it("inline signal with a known slug DOES demote", () => {
    const withKnown = new Set(["my-service"]);
    const r = classifyPreferenceScope("When working on my-service, prefer structured logging", withKnown);
    expect(r.scope).toBe("project");
    expect(r.projectSlug).toBe("my-service");
  });
});

// ---------------------------------------------------------------------------
// filterToUniversal — unit tests
// ---------------------------------------------------------------------------

const FILTER_KNOWN = new Set(["alpha-proj", "test-svc"]);

const MIXED_DOC = `---
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
- When working on test-svc, use the internal test harness.
`;

const ALL_UNIVERSAL_DOC = `---
type: preference
created: '2026-01-01'
superbrain: true
---

## Code style

- Never push directly to main.
- Always sort imports alphabetically.
`;

const ALL_PROJECT_DOC = `---
type: preference
created: '2026-01-01'
superbrain: true
---

## Code style

- For alpha-proj: use the event-sourcing pattern.
- For test-svc: use the internal test harness.
`;

describe("filterToUniversal", () => {
  it("removes project-scoped bullets and retains universal bullets", () => {
    const { universalBody, demoted } = filterToUniversal(MIXED_DOC, FILTER_KNOWN);
    expect(universalBody).toContain("Never push directly to main");
    expect(universalBody).toContain("Always sort imports alphabetically");
    expect(universalBody).toContain("Prefer Playwright");
    expect(universalBody).not.toContain("For alpha-proj");
    expect(universalBody).not.toContain("test-svc");
    expect(demoted.length).toBe(2);
  });

  it("preserves ## headings for kept entries", () => {
    const { universalBody } = filterToUniversal(MIXED_DOC, FILTER_KNOWN);
    expect(universalBody).toContain("## Code style");
    expect(universalBody).toContain("## Tools");
  });

  it("drops empty category sections", () => {
    const docWithEmptyCategory = `---
type: preference
created: '2026-01-01'
superbrain: true
---

## All project-scoped

- For alpha-proj: use the event-sourcing pattern.
- For test-svc: use the internal test harness.

## Universal rules

- Never push to main.
`;
    const { universalBody } = filterToUniversal(docWithEmptyCategory, FILTER_KNOWN);
    expect(universalBody).not.toContain("## All project-scoped");
    expect(universalBody).toContain("## Universal rules");
    expect(universalBody).toContain("Never push to main");
  });

  it("preserves frontmatter in the output", () => {
    const { universalBody } = filterToUniversal(MIXED_DOC, FILTER_KNOWN);
    expect(universalBody).toContain("type: preference");
  });

  it("returns demoted entries with correct projectSlug", () => {
    const { demoted } = filterToUniversal(MIXED_DOC, FILTER_KNOWN);
    const alphaEntry = demoted.find(d => d.projectSlug === "alpha-proj");
    const svcEntry = demoted.find(d => d.projectSlug === "test-svc");
    expect(alphaEntry).toBeDefined();
    expect(svcEntry).toBeDefined();
  });

  it("returns unchanged body for an all-universal doc", () => {
    const { universalBody, demoted } = filterToUniversal(ALL_UNIVERSAL_DOC, FILTER_KNOWN);
    expect(demoted).toHaveLength(0);
    expect(universalBody).toContain("Never push directly to main");
    expect(universalBody).toContain("Always sort imports alphabetically");
  });

  it("returns empty body (no bullets) for an all-project-scoped doc", () => {
    const { universalBody, demoted } = filterToUniversal(ALL_PROJECT_DOC, FILTER_KNOWN);
    // No bullets remain — only possibly the frontmatter / preamble
    expect(universalBody).not.toContain("- For alpha-proj");
    expect(universalBody).not.toContain("- For test-svc");
    expect(demoted.length).toBe(2);
  });

  it("passes all common-English tokens through as universal (no knownSlugs)", () => {
    const doc = `## Rules\n\n- In general, prefer composition over inheritance.\n- In production, always enable logging.\n- For event-sourcing: use an append-only log.\n`;
    const { universalBody, demoted } = filterToUniversal(doc);
    expect(demoted).toHaveLength(0);
    expect(universalBody).toContain("In general");
    expect(universalBody).toContain("In production");
    expect(universalBody).toContain("For event-sourcing");
  });
});

// ---------------------------------------------------------------------------
// Blocker 3: filterToUniversal preserves non-bullet prose under kept headings
// ---------------------------------------------------------------------------

describe("filterToUniversal — Blocker 3: prose preservation", () => {
  it("a '## Communication' section with a prose intro plus a bullet retains BOTH", () => {
    const doc = `## Communication

Keep responses concise and direct.

- Always summarize key decisions at the end.
`;
    const { universalBody, demoted } = filterToUniversal(doc);
    expect(demoted).toHaveLength(0);
    expect(universalBody).toContain("Keep responses concise and direct.");
    expect(universalBody).toContain("Always summarize key decisions at the end.");
  });

  it("a prose-only section is preserved in full", () => {
    const doc = `## Philosophy

Good code is readable code. Optimize for the next reader.
`;
    const { universalBody, demoted } = filterToUniversal(doc);
    expect(demoted).toHaveLength(0);
    expect(universalBody).toContain("## Philosophy");
    expect(universalBody).toContain("Good code is readable code.");
  });

  it("prose intro is dropped when all bullets in that section are demoted", () => {
    const knownSet = new Set(["alpha-proj"]);
    const doc = `## Project rules

Only applies to alpha-proj.

- For alpha-proj: use the event-sourcing pattern.
`;
    const { universalBody, demoted } = filterToUniversal(doc, knownSet);
    expect(demoted).toHaveLength(1);
    expect(universalBody).not.toContain("## Project rules");
  });
});
