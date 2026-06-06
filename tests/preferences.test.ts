import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileInjectionBlock, capPreferences, validateBudgetConsistency, emitPreferencesCore, PREFERENCES_CORE_MAX_TOKENS } from "../src/preferences";
import { INJECT_LIMITS, estimateTokens } from "../src/injectBudget";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pref-"));
  process.env.SUPERBRAIN_VAULT_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("capPreferences", () => {
  it("passes through content under the cap", () => {
    const small = "## rule 1\nbe nice\n";
    expect(capPreferences(small)).toBe(small);
  });

  it("truncates content over 3KB and appends a sentinel", () => {
    const long = "x".repeat(10000);
    const out = capPreferences(long);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(3072 + 60);
    expect(out.endsWith("[…truncated; see meta/preferences.md]\n")).toBe(true);
  });

  it("keeps content close to but under 3072 bytes when truncated", () => {
    const long = "x".repeat(10000);
    const out = capPreferences(long);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(3072 + 60);
  });

  it("handles multibyte unicode without splitting code points", () => {
    const u = "é".repeat(3000); // ~6000 bytes
    const out = capPreferences(u);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(3072 + 60);
    expect(out).not.toContain("�");
  });
});

it("returns '' when preferences.md is absent", () => {
  expect(compileInjectionBlock()).toBe("");
});

it("compiles a compact block from preferences.md body", () => {
  fs.mkdirSync(path.join(TMP, "meta"), { recursive: true });
  fs.writeFileSync(path.join(TMP, "meta/preferences.md"),
    "---\ntype: preference\ncreated: 2026-05-19\n---\n\n## Code\n- No inline comments\n\n## Tests\n- Integration over unit\n");
  const b = compileInjectionBlock();
  expect(b).toContain("Your preferences (SuperBrain)");
  expect(b).toContain("No inline comments");
  expect(b).toContain("Integration over unit");
});

it("returns '' for an empty/whitespace body", () => {
  fs.mkdirSync(path.join(TMP, "meta"), { recursive: true });
  fs.writeFileSync(path.join(TMP, "meta/preferences.md"), "---\ntype: preference\n---\n\n   \n");
  expect(compileInjectionBlock()).toBe("");
});

it("compileInjectionBlock applies the 3KB cap on large preferences", () => {
  fs.mkdirSync(path.join(TMP, "meta"), { recursive: true });
  const bigBody = "x".repeat(10000);
  fs.writeFileSync(path.join(TMP, "meta/preferences.md"), `---\ntype: preference\n---\n\n${bigBody}\n`);
  const out = compileInjectionBlock();
  // The block includes header/footer lines — total must stay bounded
  expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(3072 + 200);
  expect(out).toContain("[…truncated; see meta/preferences.md]");
});

describe("G11: pref-core producer/consumer budget alignment", () => {
  it("prefCore inject slot is >= PREFERENCES_CORE_MAX_TOKENS (consumer fits producer)", () => {
    expect(INJECT_LIMITS.prefCore).toBeGreaterThanOrEqual(PREFERENCES_CORE_MAX_TOKENS);
  });

  it("validateBudgetConsistency does not throw under the aligned values", () => {
    expect(() => validateBudgetConsistency()).not.toThrow();
  });

  it("a ~250-token core is not clipped to the prefCore slot", () => {
    fs.mkdirSync(path.join(TMP, "meta"), { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) {
      lines.push(`- always use pattern number ${i} when building widgets for the system`);
    }
    const body = lines.join("\n") + "\n";
    emitPreferencesCore(body);
    const written = fs.readFileSync(path.join(TMP, "meta/preferences-core.md"), "utf8");
    expect(estimateTokens(written)).toBeGreaterThanOrEqual(200);
  });
});
