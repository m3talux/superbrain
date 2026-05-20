import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-am", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-am-home", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-am-vault", { recursive: true, force: true });
  process.env.SUPERBRAIN_DATA_DIR = "/tmp/sb-am";
});

function run(args: string[], env: Record<string,string> = {}) {
  return execFileSync("npx", ["tsx", "bin/sb.ts", ...args], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-am", ...env }, encoding: "utf8" });
}

it("adopt marks + records a writable dir, refuses a file", () => {
  fs.mkdirSync("/tmp/sb-am-vault", { recursive: true });
  run(["adopt", "/tmp/sb-am-vault"]);
  expect(fs.existsSync("/tmp/sb-am-vault/.superbrain")).toBe(true);
  expect(fs.readFileSync("/tmp/sb-am/vault-path", "utf8")).toBe("/tmp/sb-am-vault");
  fs.writeFileSync("/tmp/sb-am-file", "x");
  expect(() => run(["adopt", "/tmp/sb-am-file"])).toThrow();
});

// The `migrate` subcommand was removed. /superbrain:migrate is now a fully
// LLM-driven non-destructive Obsidian-vault import (commands/migrate.md), with
// no CLI handler to unit-test. Its hard invariants (source read-only, never
// overwrite, idempotent on re-run) are encoded in the slash-command's
// instructions and lint-checked by tests/migrateCommand.test.ts.
