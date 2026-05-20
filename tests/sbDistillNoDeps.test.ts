import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_EMPTY: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dnd-data-"));
  TMP_EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dnd-empty-"));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_EMPTY, { recursive: true, force: true });
});

it("sb-distill releases the lock and exits 0 when deps absent", () => {
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA,
      CLAUDE_PLUGIN_ROOT: TMP_EMPTY, SUPERBRAIN_SESSION_ID: "S" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  expect(fs.existsSync(path.join(TMP_DATA, "locks/distill.lock"))).toBe(false);
});
