import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => fs.rmSync("/tmp/sb-obs", { recursive: true, force: true }));

function run(hookJson: object) {
  return execFileSync("npx", ["tsx", "bin/sb-observe.ts"], {
    input: JSON.stringify(hookJson),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-obs" },
    encoding: "utf8",
  });
}

describe("sb-observe", () => {
  it("appends a tool event and sets pending marker file on git commit", () => {
    run({ session_id: "S", hook_event_name: "PostToolUse", cwd: "/p",
          tool_name: "Bash", tool_input: { command: "git commit -m x" } });
    const nd = fs.readFileSync("/tmp/sb-obs/sessions/S.ndjson", "utf8");
    expect(nd).toMatch(/"tool":"Bash"/);
    expect(nd).toMatch(/"type":"salient"/);
    expect(fs.existsSync("/tmp/sb-obs/sessions/S.pending")).toBe(true);
  });
  it("no-ops when recursion guard is set", () => {
    execFileSync("npx", ["tsx", "bin/sb-observe.ts"], {
      input: JSON.stringify({ session_id: "S2", hook_event_name: "PostToolUse", cwd: "/p", tool_name: "Read" }),
      env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-obs", SUPERBRAIN_CHILD: "1" }, encoding: "utf8",
    });
    expect(fs.existsSync("/tmp/sb-obs/sessions/S2.ndjson")).toBe(false);
  });
});
