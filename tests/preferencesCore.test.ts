import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  emitPreferencesCore,
  preferencesCorePath,
  PREFERENCES_CORE_MAX_TOKENS,
} from "../src/preferences.js";
import { estimateTokens } from "../src/injectBudget.js";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pref-core-"));
  process.env.SUPERBRAIN_VAULT_DIR = TMP;
  fs.mkdirSync(path.join(TMP, "meta"), { recursive: true });
});

afterEach(() => {
  delete process.env.SUPERBRAIN_VAULT_DIR;
  fs.rmSync(TMP, { recursive: true, force: true });
});

const UNIVERSAL_BODY = `## Code style

- Never push directly to main.
- Always sort imports alphabetically.
- Avoid deep nesting beyond 3 levels.

## Style guidance

This is style guidance prose (no imperative prefix, should be excluded from core).

## Tools

- Prefer Playwright for browser automation.
- Use the built-in formatter before committing.
`;

describe("emitPreferencesCore", () => {
  it("writes only imperative-prefix lines from the universal body", () => {
    emitPreferencesCore(UNIVERSAL_BODY);
    const core = fs.readFileSync(path.join(TMP, "meta", "preferences-core.md"), "utf8");
    expect(core).toContain("Never push directly to main");
    expect(core).toContain("Always sort imports alphabetically");
    expect(core).toContain("Prefer Playwright");
    expect(core).toContain("Use the built-in formatter");
    // Style guidance prose has no imperative prefix — must NOT appear
    expect(core).not.toContain("style guidance prose");
  });

  it("output is <= PREFERENCES_CORE_MAX_TOKENS tokens", () => {
    // Build a body with many lines to test truncation
    const manyLines = Array.from({ length: 200 }, (_, i) =>
      `- Always follow rule number ${i} with great diligence and precision in all circumstances.`
    ).join("\n");
    emitPreferencesCore(manyLines);
    const core = fs.readFileSync(path.join(TMP, "meta", "preferences-core.md"), "utf8");
    expect(estimateTokens(core)).toBeLessThanOrEqual(PREFERENCES_CORE_MAX_TOKENS);
  });

  it("file exists at meta/preferences-core.md after call", () => {
    emitPreferencesCore(UNIVERSAL_BODY);
    expect(fs.existsSync(path.join(TMP, "meta", "preferences-core.md"))).toBe(true);
  });

  it("is idempotent — second call with same input overwrites with identical content", () => {
    emitPreferencesCore(UNIVERSAL_BODY);
    const first = fs.readFileSync(path.join(TMP, "meta", "preferences-core.md"), "utf8");
    emitPreferencesCore(UNIVERSAL_BODY);
    const second = fs.readFileSync(path.join(TMP, "meta", "preferences-core.md"), "utf8");
    expect(first).toBe(second);
  });

  it("handles empty universal body — writes an empty file without error", () => {
    expect(() => emitPreferencesCore("")).not.toThrow();
    const core = fs.readFileSync(path.join(TMP, "meta", "preferences-core.md"), "utf8");
    expect(core.trim()).toBe("");
  });

  it("excludes style-guidance lines (no imperative prefix) from the core", () => {
    const styleOnly = `## Style guidance\n\nThis text has no imperative prefix and should be excluded.\n`;
    emitPreferencesCore(styleOnly);
    const core = fs.readFileSync(path.join(TMP, "meta", "preferences-core.md"), "utf8");
    expect(core).not.toContain("This text has no imperative prefix");
  });
});

describe("preferencesCorePath", () => {
  it("returns the path to meta/preferences-core.md", () => {
    const p = preferencesCorePath();
    expect(p).toContain("meta");
    expect(p).toContain("preferences-core.md");
  });

  it("path is inside the vault dir", () => {
    const p = preferencesCorePath();
    expect(p.startsWith(TMP)).toBe(true);
  });
});

describe("PREFERENCES_CORE_MAX_TOKENS", () => {
  it("is a positive number around 250", () => {
    expect(PREFERENCES_CORE_MAX_TOKENS).toBeGreaterThan(0);
    expect(PREFERENCES_CORE_MAX_TOKENS).toBeLessThanOrEqual(350);
  });
});
