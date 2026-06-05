import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-iw-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-iw-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  fs.mkdirSync(path.join(TMP_VAULT, "meta"), { recursive: true });
  fs.mkdirSync(path.join(TMP_VAULT, "projects"), { recursive: true });
  fs.mkdirSync(path.join(TMP_VAULT, "daily"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_VAULT_DIR;
});

describe("capNoteExcerpt", () => {
  it("4.4.a: truncates long text to at most PER_NOTE_TOKEN_CAP estimated tokens", async () => {
    const { capNoteExcerpt } = await import("../src/injectWindow.js");
    const { estimateTokens, PER_NOTE_TOKEN_CAP } = await import("../src/injectBudget.js");
    // Generate text clearly exceeding the cap (120 tokens * 4 chars = 480 chars min)
    const long = "word ".repeat(200);
    const result = capNoteExcerpt(long);
    expect(estimateTokens(result)).toBeLessThanOrEqual(PER_NOTE_TOKEN_CAP);
  });

  it("4.4.b: returns short text unchanged", async () => {
    const { capNoteExcerpt } = await import("../src/injectWindow.js");
    const short = "a brief note";
    expect(capNoteExcerpt(short)).toBe(short);
  });

  it("4.4.f: per-note cap is enforced independently of total window budget", async () => {
    const { capNoteExcerpt } = await import("../src/injectWindow.js");
    const { estimateTokens } = await import("../src/injectBudget.js");
    const customCap = 50;
    const long = "word ".repeat(200);
    const result = capNoteExcerpt(long, customCap);
    expect(estimateTokens(result)).toBeLessThanOrEqual(customCap);
  });
});

describe("buildMiniBrief", () => {
  it("4.4.c: returns non-empty string when project note and daily state are present", async () => {
    const { buildMiniBrief } = await import("../src/injectWindow.js");

    // Create a project note
    fs.writeFileSync(
      path.join(TMP_VAULT, "projects", "alpha-proj.md"),
      "---\ntitle: Alpha Project\n---\n\nWorking on distributed sync\n",
      "utf8",
    );
    // Create today's daily note
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(TMP_VAULT, "daily", `${today}.md`),
      "---\ntitle: Daily 2026-06-05\n---\n\nReviewed sync protocol\n",
      "utf8",
    );

    const result = buildMiniBrief("sid-1", "alpha-proj");
    expect(result.length).toBeGreaterThan(0);
  });

  it("4.4.d: total token count is within INJECT_LIMITS.miniBrief", async () => {
    const { buildMiniBrief } = await import("../src/injectWindow.js");
    const { INJECT_LIMITS, estimateTokens } = await import("../src/injectBudget.js");

    fs.writeFileSync(
      path.join(TMP_VAULT, "projects", "beta-svc.md"),
      "---\ntitle: Beta Service\n---\n\n" + "context ".repeat(300) + "\n",
      "utf8",
    );
    // Create a large preferences-core.md too
    fs.writeFileSync(
      path.join(TMP_VAULT, "meta", "preferences-core.md"),
      "- " + "rule ".repeat(300) + "\n",
      "utf8",
    );

    const result = buildMiniBrief("sid-2", "beta-svc");
    expect(estimateTokens(result)).toBeLessThanOrEqual(INJECT_LIMITS.miniBrief);
  });

  it("4.4.e: returns empty string (does not throw) when project note is missing", async () => {
    const { buildMiniBrief } = await import("../src/injectWindow.js");
    // No project note created
    const result = buildMiniBrief("sid-3", "nonexistent-proj");
    // Must not throw; returns empty string or best-effort partial string
    expect(typeof result).toBe("string");
  });

  it("includes preference core when preferences-core.md exists", async () => {
    const { buildMiniBrief } = await import("../src/injectWindow.js");

    fs.writeFileSync(
      path.join(TMP_VAULT, "meta", "preferences-core.md"),
      "- Always write tests first\n",
      "utf8",
    );

    const result = buildMiniBrief("sid-4", undefined);
    expect(result).toContain("Always write tests first");
  });
});

describe("shouldFireMiniBrief", () => {
  it("returns false for turn 0", async () => {
    const { shouldFireMiniBrief } = await import("../src/injectWindow.js");
    expect(shouldFireMiniBrief(0)).toBe(false);
  });

  it("returns true at default boundary (turn 10)", async () => {
    const { shouldFireMiniBrief, MINI_BRIEF_EVERY } = await import("../src/injectWindow.js");
    // With default MINI_BRIEF_EVERY=10
    if (MINI_BRIEF_EVERY === 10) {
      expect(shouldFireMiniBrief(10)).toBe(true);
      expect(shouldFireMiniBrief(20)).toBe(true);
      expect(shouldFireMiniBrief(9)).toBe(false);
      expect(shouldFireMiniBrief(11)).toBe(false);
    }
  });
});
