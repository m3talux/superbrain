import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-dist", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-dist-vault", { recursive: true, force: true });
});

it("distills delta into routed notes, daily .log file, advances cursor, releases lock", () => {
  fs.mkdirSync("/tmp/sb-dist/sessions", { recursive: true });
  fs.writeFileSync("/tmp/sb-dist/sessions/S.ndjson",
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = "/tmp/sb-dist/stub.json";
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "decision", title: "Pick X", body: "rationale", date: "2026-05-19", links: ["SuperBrain"] },
  ]));
  fs.mkdirSync("/tmp/sb-dist/locks/distill.lock", { recursive: true });
  fs.writeFileSync("/tmp/sb-dist/sessions/S.prompt.json", "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-dist",
      SUPERBRAIN_VAULT_DIR: "/tmp/sb-dist-vault", SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  expect(fs.existsSync("/tmp/sb-dist-vault/decisions/2026-05-19-pick-x.md")).toBe(true);
  // The daily .log file lives in dataDir/logs/<today>.log and is named with the
  // current date (not the item's date) since appendLog stamps it at write time.
  const today = new Date().toISOString().slice(0, 10);
  expect(fs.readFileSync(`/tmp/sb-dist/logs/${today}.log`, "utf8")).toMatch(/Pick X/);
  expect(Number(fs.readFileSync("/tmp/sb-dist/sessions/S.cursor", "utf8"))).toBeGreaterThan(0);
  expect(fs.existsSync("/tmp/sb-dist/locks/distill.lock")).toBe(false);
});
