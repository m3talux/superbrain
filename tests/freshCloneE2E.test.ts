import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let CLONE: string;
let TMP_DATA: string;

beforeEach(() => {
  CLONE = fs.mkdtempSync(path.join(os.tmpdir(), "sb-fresh-clone-"));
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-fresh-data-"));
  // Simulate a marketplace clone: committed dist/ + manifests, NO node_modules.
  for (const d of ["dist", ".claude-plugin", "hooks"])
    fs.cpSync(d, path.join(CLONE, d), { recursive: true });
  fs.copyFileSync("package.json", path.join(CLONE, "package.json"));
});

afterEach(() => {
  // SessionStart spawns a detached bootstrap child that may still be writing
  // when this fires; ENOTEMPTY / EBUSY can occur briefly. maxRetries rides
  // it out instead of failing the test.
  const opts = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };
  fs.rmSync(CLONE, opts);
  fs.rmSync(TMP_DATA, opts);
});

it("every hook entrypoint loads + exits 0 with NO node_modules; SessionStart bootstraps", () => {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: CLONE, SUPERBRAIN_DATA_DIR: TMP_DATA,
    SUPERBRAIN_BOOTSTRAP_FAKE: "1", SUPERBRAIN_FAKE_DISTILLER: "1" };
  for (const b of ["sb-observe", "sb-checkpoint", "sb-recall", "sb-distill"]) {
    const r = execFileSync(process.execPath, [path.join(CLONE, "dist/bin", `${b}.js`)], {
      input: JSON.stringify({ session_id: "S", prompt: "x", hook_event_name: "Stop" }),
      env, encoding: "utf8" }); // must not throw
    expect(typeof r).toBe("string");
  }
  const ss = execFileSync(process.execPath, [path.join(CLONE, "dist/bin/sb-session-start.js")], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env, encoding: "utf8" });
  expect(ss).toMatch(/rebuilding native dependencies/i);
});
