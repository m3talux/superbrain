import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-am", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-am-home", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-am-vault", { recursive: true, force: true });
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-am";
});

function run(args: string[], env: Record<string,string> = {}) {
  return execFileSync("npx", ["tsx", "bin/sb.ts", ...args], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-am", ...env }, encoding: "utf8" });
}

it("adopt marks + records a writable dir, refuses a file", () => {
  fs.mkdirSync("/tmp/sb-am-vault", { recursive: true });
  run(["adopt", "/tmp/sb-am-vault"]);
  expect(fs.existsSync("/tmp/sb-am-vault/.superbrain")).toBe(true);
  expect(fs.readFileSync("/tmp/sb-am/vault-path", "utf8")).toBe("/tmp/sb-am-vault");
  fs.writeFileSync("/tmp/sb-am-file", "x");
  expect(() => run(["adopt", "/tmp/sb-am-file"])).toThrow();
});

it("migrate copies-then-unlinks legacy scribe, idempotent, dry-run is inert", () => {
  const hooks = "/tmp/sb-am-home/.claude/hooks";
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(`${hooks}/stop-scribe.sh`, "#legacy\n");
  run(["migrate", "--dry-run"], { HOME: "/tmp/sb-am-home" });
  expect(fs.existsSync(`${hooks}/stop-scribe.sh`)).toBe(true); // dry-run: untouched
  run(["migrate"], { HOME: "/tmp/sb-am-home" });
  expect(fs.existsSync(`${hooks}/stop-scribe.sh`)).toBe(false); // moved
  const archived = fs.readdirSync("/tmp/sb-am/archived-legacy");
  expect(archived.length).toBe(1);
  const r2 = run(["migrate"], { HOME: "/tmp/sb-am-home" }); // idempotent
  expect(r2).toMatch(/nothing to migrate|no legacy/i);
});
