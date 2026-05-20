import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dist-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dist-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("distills delta into routed notes, daily .log file, advances cursor, releases lock", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "decision", title: "Pick X", body: "rationale", date: "2026-05-19", links: ["SuperBrain"] },
  ]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.prompt.json"), "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT, SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  expect(fs.existsSync(path.join(TMP_VAULT, "decisions/2026-05-19-pick-x.md"))).toBe(true);
  // The daily .log file lives in dataDir/logs/<today>.log and is named with the
  // current date (not the item's date) since appendLog stamps it at write time.
  const today = new Date().toISOString().slice(0, 10);
  expect(fs.readFileSync(path.join(TMP_DATA, `logs/${today}.log`), "utf8")).toMatch(/Pick X/);
  expect(Number(fs.readFileSync(path.join(TMP_DATA, "sessions/S.cursor"), "utf8"))).toBeGreaterThan(0);
  expect(fs.existsSync(path.join(TMP_DATA, "locks/distill.lock"))).toBe(false);
});
