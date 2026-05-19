import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { needsRollup, markRollup } from "../src/rollupState";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-rollup";
  fs.rmSync("/tmp/sb-rollup", { recursive: true, force: true });
});

describe("rollupState", () => {
  it("needs rollup when never compiled", () => {
    expect(needsRollup("daily", "2026-05-18", "hashA")).toBe(true);
  });
  it("does not need rollup when same hash already compiled", () => {
    markRollup("daily", "2026-05-18", "hashA");
    expect(needsRollup("daily", "2026-05-18", "hashA")).toBe(false);
  });
  it("needs rollup again when source hash changed", () => {
    markRollup("daily", "2026-05-18", "hashA");
    expect(needsRollup("daily", "2026-05-18", "hashB")).toBe(true);
  });
});
