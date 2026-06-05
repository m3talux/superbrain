import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendCandidate, autoPromoteCandidates, isPromotable } from "../src/preferenceCandidates.js";

describe("isPromotable", () => {
  it("promotes a 3x imperative cross-project rule", () => {
    expect(isPromotable({ rule: "always sort imports" }, 3)).toBe(true);
  });
  it("rejects fewer than 3 observations", () => {
    expect(isPromotable({ rule: "always sort imports" }, 2)).toBe(false);
  });
  it("rejects a project-scoped rule", () => {
    expect(isPromotable({ rule: "for Alpha-proj: use middle-east founding market" }, 5)).toBe(false);
  });
  it("rejects non-imperative", () => {
    expect(isPromotable({ rule: "I learned about gray-matter" }, 5)).toBe(false);
  });
  it("accepts 'never' and 'prefer' imperatives", () => {
    expect(isPromotable({ rule: "never push directly to main" }, 3)).toBe(true);
    expect(isPromotable({ rule: "prefer hexagonal architecture for backend services" }, 3)).toBe(true);
  });
  it("rejects rules over the length budget", () => {
    expect(isPromotable({ rule: "always " + "x".repeat(300) }, 3)).toBe(false);
  });
});

describe("appendCandidate + autoPromoteCandidates", () => {
  let vaultDir: string;
  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbpc-"));
    // Seed a minimal preferences.md for promotion target
    fs.mkdirSync(path.join(vaultDir, "meta"), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, "meta", "preferences.md"),
      `---\ntype: preference\nsuperbrain: true\n---\n# Preferences\n\n## Existing rule\nbody.\n`);
  });

  it("creates candidates file with frontmatter on first append", () => {
    appendCandidate(vaultDir, { rule: "always sort imports", note: "PR review" });
    const text = fs.readFileSync(path.join(vaultDir, "meta", "preferences-candidates.md"), "utf8");
    expect(text).toMatch(/^---\ntype: preference-candidates/);
    expect(text).toContain("**Rule:** always sort imports");
    expect(text).toContain("**Note:** PR review");
  });

  it("accumulates multiple entries", () => {
    appendCandidate(vaultDir, { rule: "always sort imports", note: "obs 1" });
    appendCandidate(vaultDir, { rule: "always sort imports", note: "obs 2" });
    const text = fs.readFileSync(path.join(vaultDir, "meta", "preferences-candidates.md"), "utf8");
    const blocks = text.match(/^## /gm) || [];
    expect(blocks.length).toBe(2);
  });

  it("auto-promotes after 3 imperative cross-project observations", () => {
    for (let i = 0; i < 3; i++) appendCandidate(vaultDir, { rule: "always sort imports", note: `obs ${i}` });
    const promoted = autoPromoteCandidates(vaultDir);
    expect(promoted).toContain("always sort imports");
    const core = fs.readFileSync(path.join(vaultDir, "meta", "preferences.md"), "utf8");
    expect(core).toContain("always sort imports");
    // Candidates file no longer contains this rule
    const candidates = fs.readFileSync(path.join(vaultDir, "meta", "preferences-candidates.md"), "utf8");
    expect(candidates).not.toContain("**Rule:** always sort imports");
  });

  it("does not promote project-scoped candidates even after 5 observations", () => {
    for (let i = 0; i < 5; i++) appendCandidate(vaultDir, { rule: "for Alpha-proj: use middle-east founding market" });
    const promoted = autoPromoteCandidates(vaultDir);
    expect(promoted).not.toContain("for Alpha-proj: use middle-east founding market");
  });

  it("counts variants of same rule (case + trailing punctuation)", () => {
    appendCandidate(vaultDir, { rule: "Always sort imports" });
    appendCandidate(vaultDir, { rule: "always sort imports." });
    appendCandidate(vaultDir, { rule: "ALWAYS SORT IMPORTS" });
    const promoted = autoPromoteCandidates(vaultDir);
    expect(promoted.length).toBe(1);
    expect(promoted[0].toLowerCase()).toContain("sort imports");
  });
});
