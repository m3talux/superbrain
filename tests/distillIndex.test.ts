import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex";

beforeEach(() => {
  process.env.SUPERBRAIN_DATA_DIR = "/tmp/sb-di";
  process.env.SUPERBRAIN_VAULT_DIR = "/tmp/sb-di-vault";
  fs.rmSync("/tmp/sb-di", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-di-vault", { recursive: true, force: true });
});

it("a note written by the distiller is searchable in the index", () => {
  fs.mkdirSync("/tmp/sb-di/sessions", { recursive: true });
  fs.writeFileSync("/tmp/sb-di/sessions/S.ndjson",
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = "/tmp/sb-di/stub.json";
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "decision", title: "Adopt sqlite-vec", body: "fast local KNN", date: "2026-05-19", links: [] },
  ]));
  fs.mkdirSync("/tmp/sb-di/locks/distill.lock", { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-di", SUPERBRAIN_VAULT_DIR: "/tmp/sb-di-vault",
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  const ix = openIndex();
  expect(ix.bm25("sqlite-vec", 5).length).toBeGreaterThan(0);
  ix.close();
});
