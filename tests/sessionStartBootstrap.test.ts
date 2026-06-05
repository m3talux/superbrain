import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_EMPTY: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ssb-data-"));
  TMP_EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ssb-empty-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_EMPTY, { recursive: true, force: true });
});

it("no deps: emits the rebuilding-native-deps notice, exits 0, does NOT crash", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, CLAUDE_PLUGIN_ROOT: TMP_EMPTY,
      SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/native dependencies/i);
  expect(out).toMatch(/recall/i);
  expect(out).toMatch(/additionalContext/);
});
