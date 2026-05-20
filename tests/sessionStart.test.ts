import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ss-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ss-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function run() {
  return execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
           SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

it("surfaces a prior failure once via additionalContext", () => {
  fs.writeFileSync(path.join(TMP_DATA, "last-failure.txt"), "[t] distill failed: boom\n");
  const out = run();
  expect(out).toMatch(/additionalContext/);
  expect(out).toMatch(/distill failed: boom/);
  const out2 = run();
  expect(out2).not.toMatch(/boom/);
});

it("triggers a (faked) daily rollup when none compiled", () => {
  run();
  expect(fs.existsSync(path.join(TMP_DATA, "rollup-invoked"))).toBe(true);
});
