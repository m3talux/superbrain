import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { needsRollup, markRollup } from "../src/rollupState";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rollup-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
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
