import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-rd", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-rd-vault", { recursive: true, force: true });
});

it("rollup path also regenerates the daily note for the rollup key", () => {
  fs.mkdirSync("/tmp/sb-rd-vault", { recursive: true });
  fs.mkdirSync("/tmp/sb-rd/logs", { recursive: true });
  fs.writeFileSync("/tmp/sb-rd/logs/2026-05-18.log", "[2026-05-18 10:00] write | Did stuff | decisions/x\n");
  const stub = "/tmp/sb-rd/stub.json";
  fs.writeFileSync(stub, JSON.stringify({
    items: [{ kind: "capture", title: "Daily 2026-05-18", body: "synthesis", date: "2026-05-18", links: [] }],
    digest: "Rollup synthesis for the day",
  }));
  fs.mkdirSync("/tmp/sb-rd/locks/distill.lock", { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-rd", SUPERBRAIN_VAULT_DIR: "/tmp/sb-rd-vault",
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "rollup-2026-05-18",
      SUPERBRAIN_ROLLUP: "daily:2026-05-18:v1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  const daily = fs.readFileSync("/tmp/sb-rd-vault/daily/2026-05-18.md", "utf8");
  expect(daily).toContain("# 2026-05-18");
  expect(daily).toContain("Rollup synthesis for the day");
});
