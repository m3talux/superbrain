import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-am-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-am-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function run(args: string[], env: Record<string,string> = {}) {
  return execFileSync("npx", ["tsx", "bin/sb.ts", ...args], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, ...env }, encoding: "utf8",
    shell: process.platform === "win32" });
}

it("adopt marks + records a writable dir, refuses a file", () => {
  run(["adopt", TMP_VAULT]);
  expect(fs.existsSync(path.join(TMP_VAULT, ".superbrain"))).toBe(true);
  expect(fs.readFileSync(path.join(TMP_DATA, "vault-path"), "utf8")).toBe(TMP_VAULT);
  const tmpFile = path.join(TMP_DATA, "sb-am-file");
  fs.writeFileSync(tmpFile, "x");
  expect(() => run(["adopt", tmpFile])).toThrow();
});

// The `migrate` subcommand was removed. /superbrain:migrate is now a fully
// LLM-driven non-destructive Obsidian-vault import (commands/migrate.md), with
// no CLI handler to unit-test. Its hard invariants (source read-only, never
// overwrite, idempotent on re-run) are encoded in the slash-command's
// instructions and lint-checked by tests/migrateCommand.test.ts.
