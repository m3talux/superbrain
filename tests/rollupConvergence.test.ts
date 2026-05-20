import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;
let TMP_BIN: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-conv-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-conv-vault-"));
  TMP_BIN = fs.mkdtempSync(path.join(os.tmpdir(), "sb-conv-bin-"));
  // fake claude: append a line to a call-counter file each invocation, print a JSON array
  fs.writeFileSync(path.join(TMP_BIN, "claude"),
    `#!/usr/bin/env bash\necho call >> ${path.join(TMP_DATA, "claude-calls")}\necho '[{"kind":"capture","title":"Daily 2026-05-18","body":"s","date":"2026-05-18","links":[]}]'\n`);
  fs.chmodSync(path.join(TMP_BIN, "claude"), 0o755);
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  fs.rmSync(TMP_BIN, { recursive: true, force: true });
});

// Skip on Windows: uses a bash-shebanged stub `claude` on PATH (with POSIX
// `:` separator) — both are POSIX-only constructs. The convergence guarantee
// is platform-independent; covering it on Linux + macOS is sufficient.
const itPosix = process.platform === "win32" ? it.skip : it;
itPosix("daily rollup converges: real path triggers the writer at most once across repeated session starts", () => {
  const env = { ...process.env, PATH: `${TMP_BIN}:${process.env.PATH}`,
    SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
    SUPERBRAIN_EMBED_STUB: "1" };
  const input = JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" });
  for (let i = 0; i < 3; i++) {
    execFileSync("node", ["dist/bin/sb-session-start.js"], { input, env, encoding: "utf8" });
    execFileSync("bash", ["-c", "sleep 2"]);
  }
  const callsFile = path.join(TMP_DATA, "claude-calls");
  const calls = fs.existsSync(callsFile)
    ? fs.readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).length : 0;
  // Exactly one rollup synthesis call total (subsequent session starts must NOT re-trigger).
  expect(calls).toBe(1);
  const state = JSON.parse(fs.readFileSync(path.join(TMP_DATA, "rollup-state.json"), "utf8"));
  expect(state["daily:" + new Date(Date.now() - 86400000).toISOString().slice(0,10)]).toBe("v1");
});
