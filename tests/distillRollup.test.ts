import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-dr", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-dr-vault", { recursive: true, force: true });
});

it("rollup mode writes a daily note and marks rollup state", () => {
  fs.mkdirSync("/tmp/sb-dr-vault", { recursive: true });
  fs.writeFileSync("/tmp/sb-dr-vault/log.md", "## [2026-05-18 10:00] write | did things | [[x]]\n");
  const stub = "/tmp/sb-dr/stub.json";
  fs.mkdirSync("/tmp/sb-dr", { recursive: true });
  fs.writeFileSync(stub, JSON.stringify([{ kind: "capture", title: "Daily 2026-05-18", body: "summary", date: "2026-05-18", links: [] }]));
  fs.mkdirSync("/tmp/sb-dr/locks/distill.lock", { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-dr", SUPERBRAIN_VAULT: "/tmp/sb-dr-vault",
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_ROLLUP: "daily:2026-05-18:42" },
    encoding: "utf8",
  });
  expect(fs.existsSync("/tmp/sb-dr-vault/capture/2026-05-18-daily-2026-05-18.md")).toBe(true);
  const state = JSON.parse(fs.readFileSync("/tmp/sb-dr/rollup-state.json", "utf8"));
  expect(state["daily:2026-05-18"]).toBe("42");
  expect(fs.existsSync("/tmp/sb-dr/locks/distill.lock")).toBe(false);
});
