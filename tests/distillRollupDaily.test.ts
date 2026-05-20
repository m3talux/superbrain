import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rd-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rd-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("rollup path also regenerates the daily note for the rollup key", () => {
  fs.mkdirSync(path.join(TMP_DATA, "logs"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "logs/2026-05-18.log"), "[2026-05-18 10:00] write | Did stuff | decisions/x\n");
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify({
    items: [{ kind: "capture", title: "Daily 2026-05-18", body: "synthesis", date: "2026-05-18", links: [] }],
    digest: "Rollup synthesis for the day",
  }));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "rollup-2026-05-18",
      SUPERBRAIN_ROLLUP: "daily:2026-05-18:v1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  const daily = fs.readFileSync(path.join(TMP_VAULT, "daily/2026-05-18.md"), "utf8");
  expect(daily).toContain("# 2026-05-18");
  expect(daily).toContain("Rollup synthesis for the day");
});
