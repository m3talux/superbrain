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
  // SessionStart spawns a detached bootstrap child that can still be writing
  // when this fires (especially on Windows). 5s retry window rides it out.
  const opts = { recursive: true, force: true, maxRetries: 20, retryDelay: 250 };
  fs.rmSync(TMP_DATA, opts);
  fs.rmSync(TMP_EMPTY, opts);
});

it("no deps: emits the rebuilding-native-deps notice, exits 0, does NOT crash", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, CLAUDE_PLUGIN_ROOT: TMP_EMPTY,
      SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  expect(out).toMatch(/rebuilding native dependencies/i);
  expect(out).toMatch(/additionalContext/);
});
