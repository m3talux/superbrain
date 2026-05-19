import { it, expect } from "vitest";
import fs from "node:fs";

it("the distiller prompt construction includes current preferences when present", () => {
  const src = fs.readFileSync("src/distillRun.ts", "utf8");
  expect(src).toMatch(/preferencesPath|meta\/preferences\.md/);
  expect(src).toMatch(/Current preferences/);
});

it("SKILL.md documents the envelope contract and new kinds", () => {
  const s = fs.readFileSync("skills/superbrain-distill/SKILL.md", "utf8");
  expect(s).toMatch(/"items"/);
  expect(s).toMatch(/lesson/);
  expect(s).toMatch(/preference/);
  expect(s).toMatch(/openThreads/);
  expect(s).toMatch(/generaliz/i);
});
