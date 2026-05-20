import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-dnd", { recursive: true, force: true });
  fs.mkdirSync("/tmp/sb-dnd/locks/distill.lock", { recursive: true });
  fs.mkdirSync("/tmp/sb-dnd-empty", { recursive: true });
});

it("sb-distill releases the lock and exits 0 when deps absent", () => {
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-dnd",
      CLAUDE_PLUGIN_ROOT: "/tmp/sb-dnd-empty", SUPERBRAIN_SESSION_ID: "S" },
    encoding: "utf8",
  });
  expect(fs.existsSync("/tmp/sb-dnd/locks/distill.lock")).toBe(false);
});
