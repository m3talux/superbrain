import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => fs.rmSync("/tmp/sb-ckpt", { recursive: true, force: true }));

function run(hook: object, extraEnv: Record<string, string> = {}) {
  return execFileSync("npx", ["tsx", "bin/sb-checkpoint.ts"], {
    input: JSON.stringify(hook),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-ckpt",
           SUPERBRAIN_FAKE_DISTILLER: "1", ...extraEnv },
    encoding: "utf8",
  });
}

describe("sb-checkpoint", () => {
  it("Stop with no pending marker is a no-op", () => {
    run({ session_id: "S", hook_event_name: "Stop", cwd: "/p", transcript_path: "/dev/null" });
    expect(fs.existsSync("/tmp/sb-ckpt/distill-invoked")).toBe(false);
  });
  it("Stop with pending marker invokes the (faked) distiller and clears pending", () => {
    fs.mkdirSync("/tmp/sb-ckpt/sessions", { recursive: true });
    fs.writeFileSync("/tmp/sb-ckpt/sessions/S.pending", "1");
    run({ session_id: "S", hook_event_name: "Stop", cwd: "/p", transcript_path: "/dev/null" });
    expect(fs.existsSync("/tmp/sb-ckpt/distill-invoked")).toBe(true);
    expect(fs.existsSync("/tmp/sb-ckpt/sessions/S.pending")).toBe(false);
  });
  it("PreCompact always invokes distiller (no pending needed) and never blocks (exit 0)", () => {
    run({ session_id: "S", hook_event_name: "PreCompact", cwd: "/p", transcript_path: "/dev/null" });
    expect(fs.existsSync("/tmp/sb-ckpt/distill-invoked")).toBe(true);
  });
  it("recursion guard makes it a no-op", () => {
    run({ session_id: "S", hook_event_name: "PreCompact", cwd: "/p", transcript_path: "/dev/null" }, { SUPERBRAIN_CHILD: "1" });
    expect(fs.existsSync("/tmp/sb-ckpt/distill-invoked")).toBe(false);
  });
});
