import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-obs-"));
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function run(hookJson: object) {
  return execFileSync("npx", ["tsx", "bin/sb-observe.ts"], {
    input: JSON.stringify(hookJson),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

describe("sb-observe", () => {
  it("appends a tool event and sets pending marker file on git commit", () => {
    run({ session_id: "S", hook_event_name: "PostToolUse", cwd: "/p",
          tool_name: "Bash", tool_input: { command: "git commit -m x" } });
    const nd = fs.readFileSync(path.join(TMP, "sessions/S.ndjson"), "utf8");
    expect(nd).toMatch(/"tool":"Bash"/);
    expect(nd).toMatch(/"type":"salient"/);
    expect(fs.existsSync(path.join(TMP, "sessions/S.pending"))).toBe(true);
  });
  it("no-ops when recursion guard is set", () => {
    execFileSync("npx", ["tsx", "bin/sb-observe.ts"], {
      input: JSON.stringify({ session_id: "S2", hook_event_name: "PostToolUse", cwd: "/p", tool_name: "Read" }),
      env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP, SUPERBRAIN_CHILD: "1" }, encoding: "utf8",
      shell: process.platform === "win32",
    });
    expect(fs.existsSync(path.join(TMP, "sessions/S2.ndjson"))).toBe(false);
  });
});
