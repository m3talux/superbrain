import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dd-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dd-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("writes a daily note aggregating the session's routed items + envelope fields", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify({
    items: [{ kind: "decision", title: "Pick X", body: "why", date: "2026-05-19", links: [] }],
    digest: "Chose X for the pipeline", openThreads: ["wire Y"], alsoDid: ["cleaned logs"],
  }));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  const daily = fs.readFileSync(path.join(TMP_VAULT, "daily/2026-05-19.md"), "utf8");
  expect(daily).toContain("# 2026-05-19");
  expect(daily).toContain("Chose X for the pipeline");
  expect(daily).toContain("[[decisions/2026-05-19-pick-x]]");
  expect(daily).toContain("wire Y");
  expect(daily).toContain("cleaned logs");
});
