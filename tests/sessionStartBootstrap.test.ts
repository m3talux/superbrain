import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-ssb", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-ssb-empty", { recursive: true, force: true });
  fs.mkdirSync("/tmp/sb-ssb-empty", { recursive: true });
});

it("no deps: emits first-time-setup notice, exits 0, does NOT crash", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-ssb", CLAUDE_PLUGIN_ROOT: "/tmp/sb-ssb-empty",
      SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/first-time setup/i);
  expect(out).toMatch(/additionalContext/);
});
