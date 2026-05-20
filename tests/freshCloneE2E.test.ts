import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CLONE = "/tmp/sb-fresh";
beforeEach(() => {
  fs.rmSync(CLONE, { recursive: true, force: true });
  fs.mkdirSync(CLONE, { recursive: true });
  // Simulate a marketplace clone: committed dist/ + manifests, NO node_modules.
  for (const d of ["dist", ".claude-plugin", "hooks"])
    fs.cpSync(d, path.join(CLONE, d), { recursive: true });
  fs.copyFileSync("package.json", path.join(CLONE, "package.json"));
});

it("every hook entrypoint loads + exits 0 with NO node_modules; SessionStart bootstraps", () => {
  const dataDir = "/tmp/sb-fresh-data";
  fs.rmSync(dataDir, { recursive: true, force: true });
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: CLONE, SUPERBRAIN_DATA_DIR: dataDir,
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
  expect(ss).toMatch(/first-time setup/i);
});
