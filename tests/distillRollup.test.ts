import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dr-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dr-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("rollup mode writes a daily note and marks rollup state", () => {
  const stub = path.join(TMP_DATA, "stub.json");
  fs.mkdirSync(path.join(TMP_DATA, "logs"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "logs/2026-05-18.log"), "[2026-05-18 10:00] write | did things | x\n");
  fs.writeFileSync(stub, JSON.stringify([{ kind: "capture", title: "Daily 2026-05-18", body: "summary", date: "2026-05-18", links: [] }]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_ROLLUP: "daily:2026-05-18:42",
      SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  expect(fs.existsSync(path.join(TMP_VAULT, "capture/2026-05-18-daily-2026-05-18.md"))).toBe(true);
  const state = JSON.parse(fs.readFileSync(path.join(TMP_DATA, "rollup-state.json"), "utf8"));
  expect(state["daily:2026-05-18"]).toBe("42");
  expect(fs.existsSync(path.join(TMP_DATA, "locks/distill.lock"))).toBe(false);
});
