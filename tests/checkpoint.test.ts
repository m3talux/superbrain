import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ckpt-"));
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function run(hook: object, extraEnv: Record<string, string> = {}) {
  return execFileSync("npx", ["tsx", "bin/sb-checkpoint.ts"], {
    input: JSON.stringify(hook),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP,
           SUPERBRAIN_FAKE_DISTILLER: "1", ...extraEnv },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

describe("sb-checkpoint", () => {
  it("Stop with no pending marker is a no-op", () => {
    run({ session_id: "S", hook_event_name: "Stop", cwd: "/p", transcript_path: "/dev/null" });
    expect(fs.existsSync(path.join(TMP, "distill-invoked"))).toBe(false);
  });
  it("Stop with pending marker invokes the (faked) distiller and clears pending", () => {
    fs.mkdirSync(path.join(TMP, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(TMP, "sessions/S.pending"), "1");
    run({ session_id: "S", hook_event_name: "Stop", cwd: "/p", transcript_path: "/dev/null" });
    expect(fs.existsSync(path.join(TMP, "distill-invoked"))).toBe(true);
    expect(fs.existsSync(path.join(TMP, "sessions/S.pending"))).toBe(false);
  });
  it("PreCompact always invokes distiller (no pending needed) and never blocks (exit 0)", () => {
    run({ session_id: "S", hook_event_name: "PreCompact", cwd: "/p", transcript_path: "/dev/null" });
    expect(fs.existsSync(path.join(TMP, "distill-invoked"))).toBe(true);
  });
  it("recursion guard makes it a no-op", () => {
    run({ session_id: "S", hook_event_name: "PreCompact", cwd: "/p", transcript_path: "/dev/null" }, { SUPERBRAIN_CHILD: "1" });
    expect(fs.existsSync(path.join(TMP, "distill-invoked"))).toBe(false);
  });
});
