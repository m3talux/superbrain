import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIST_CHECKPOINT = path.resolve("dist/bin/sb-checkpoint.js");

let TMP_DATA: string;
let TMP_VAULT: string;
let TMP_BIN: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-int-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-int-vault-"));
  TMP_BIN = fs.mkdtempSync(path.join(os.tmpdir(), "sb-int-bin-"));
  // fake `claude` that prints a JSON array (mimics distiller LLM output)
  fs.writeFileSync(path.join(TMP_BIN, "claude"),
    '#!/usr/bin/env bash\necho \'[{"kind":"decision","title":"Use X","body":"why","date":"2026-05-19","links":["SuperBrain"]}]\'\n');
  fs.chmodSync(path.join(TMP_BIN, "claude"), 0o755);
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  fs.rmSync(TMP_BIN, { recursive: true, force: true });
});

// Skip on Windows: this test stubs the `claude` binary via a bash-shebanged
// shell script on PATH, which Windows can't execute. The non-real-path tests
// use SUPERBRAIN_DISTILL_STUB instead and DO run on every OS.
const itPosix = process.platform === "win32" ? it.skip : it;
itPosix("real checkpoint path (no fake seam) writes a vault note and releases the lock", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.pending"), "1");
  execFileSync("node", [DIST_CHECKPOINT], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "Stop", cwd: "/p", transcript_path: "/dev/null" }),
    env: { ...process.env, PATH: `${TMP_BIN}:${process.env.PATH}`,
      SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT },
    encoding: "utf8",
  });
  // checkpoint spawns the detached writer; give it a moment
  execFileSync("bash", ["-c", "sleep 2"]);
  const found = fs.existsSync(TMP_VAULT) && fs.readdirSync(TMP_VAULT, { recursive: true } as any)
    .some((f: any) => String(f).endsWith(".md"));
  expect(found).toBe(true);
  const today = new Date().toISOString().slice(0, 10);
  expect(fs.readFileSync(path.join(TMP_DATA, `logs/${today}.log`), "utf8")).toMatch(/Use X/);
  expect(fs.existsSync(path.join(TMP_DATA, "locks/distill.lock"))).toBe(false);
});
