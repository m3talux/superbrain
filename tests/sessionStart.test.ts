import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => fs.rmSync("/tmp/sb-ss", { recursive: true, force: true }));

function run() {
  return execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-ss", SUPERBRAIN_VAULT_DIR: "/tmp/sb-ss-vault",
           SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
}

it("surfaces a prior failure once via additionalContext", () => {
  fs.mkdirSync("/tmp/sb-ss", { recursive: true });
  fs.writeFileSync("/tmp/sb-ss/last-failure.txt", "[t] distill failed: boom\n");
  const out = run();
  expect(out).toMatch(/additionalContext/);
  expect(out).toMatch(/distill failed: boom/);
  const out2 = run();
  expect(out2).not.toMatch(/boom/);
});

it("triggers a (faked) daily rollup when none compiled", () => {
  run();
  expect(fs.existsSync("/tmp/sb-ss/rollup-invoked")).toBe(true);
});
