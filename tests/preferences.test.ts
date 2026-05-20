import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileInjectionBlock } from "../src/preferences";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pref-"));
  process.env.SUPERBRAIN_VAULT_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
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
