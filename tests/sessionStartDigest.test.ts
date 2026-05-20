import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex.js";

beforeEach(() => {
  fs.rmSync("/tmp/sb-ssd", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-ssd-vault", { recursive: true, force: true });
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  const old = process.env.SUPERBRAIN_DATA_DIR; process.env.SUPERBRAIN_DATA_DIR = "/tmp/sb-ssd";
  const ix = openIndex();
  // Fixture text includes "recent work" so that BM25 OR-query tokens from the seed
  // ("recent", "work") lexically overlap the indexed content — required because hybridRecall
  // is BM25-gated in P2.0 (spec §"Known limitation (P2.0)": if bm25 returns [] the gate
  // returns [] immediately, deferring pure-semantic recall to P2.1).
  ix.upsertNote("projects/super-brain.md", 1, "h",
    [{ headingPath: "Status", anchor: "status", text: "recent work: phase 1 shipped; phase 2 adds hybrid search" }],
    [Float32Array.from(Array(384).fill(0.6))]);
  ix.close(); process.env.SUPERBRAIN_DATA_DIR = old;
});

it("SessionStart emits a hybrid recall digest in additionalContext", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-ssd", SUPERBRAIN_VAULT_DIR: "/tmp/sb-ssd-vault",
           SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/additionalContext/);
  expect(out).toMatch(/super-brain/);
});
