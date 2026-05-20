import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { compileInjectionBlock } from "../src/preferences";

beforeEach(() => {
  fs.rmSync("/tmp/sb-pref", { recursive: true, force: true });
  process.env.SUPERBRAIN_VAULT_DIR = "/tmp/sb-pref";
});

it("returns '' when preferences.md is absent", () => {
  expect(compileInjectionBlock()).toBe("");
});

it("compiles a compact block from preferences.md body", () => {
  fs.mkdirSync("/tmp/sb-pref/meta", { recursive: true });
  fs.writeFileSync("/tmp/sb-pref/meta/preferences.md",
    "---\ntype: preference\ncreated: 2026-05-19\n---\n\n## Code\n- No inline comments\n\n## Tests\n- Integration over unit\n");
  const b = compileInjectionBlock();
  expect(b).toContain("Your preferences (SuperBrain)");
  expect(b).toContain("No inline comments");
  expect(b).toContain("Integration over unit");
});

it("returns '' for an empty/whitespace body", () => {
  fs.mkdirSync("/tmp/sb-pref/meta", { recursive: true });
  fs.writeFileSync("/tmp/sb-pref/meta/preferences.md", "---\ntype: preference\n---\n\n   \n");
  expect(compileInjectionBlock()).toBe("");
});
