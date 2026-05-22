import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-gc-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-gc-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("happy path: GCs the transcript snapshot after a successful distill", () => {
  // Set up a minimal session with enough signal to pass the skip check.
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions/SID.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );

  // Plant a snapshot file that should be GC'd on success.
  const transcriptsDir = path.join(TMP_DATA, "transcripts");
  fs.mkdirSync(transcriptsDir, { recursive: true });
  const snapshotFile = path.join(transcriptsDir, "SID.jsonl");
  fs.writeFileSync(snapshotFile, '{"type":"tool"}\n');

  // Stub envelope so no real LLM call happens.
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(
    stub,
    JSON.stringify([
      { kind: "decision", title: "Pick X", project: "test",
        body: "## Decision\nPick X.\n## Why\n- Best fit.\n## Alternatives considered\n- **Alt A** — rejected because cost.\n## Consequences\n- Trade-offs apply.",
        date: "2026-05-19", links: [] },
    ]),
  );

  // Lock dir must exist (sb-distill expects to release it).
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "SID",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });

  // Distill succeeded — snapshot must be gone.
  expect(fs.existsSync(snapshotFile)).toBe(false);
});

it("failure path: snapshot REMAINS when distill encounters an error", () => {
  // Set up a session ndjson but no sessions directory for cursor writes —
  // the cursor write will throw, triggering the catch/failure path.
  // Actually a more reliable failure: provide a SUPERBRAIN_DISTILL_STUB that
  // points to a non-existent file so getEnvelope throws.
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions/SID.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );

  // Plant the snapshot.
  const transcriptsDir = path.join(TMP_DATA, "transcripts");
  fs.mkdirSync(transcriptsDir, { recursive: true });
  const snapshotFile = path.join(transcriptsDir, "SID.jsonl");
  fs.writeFileSync(snapshotFile, '{"type":"tool"}\n');

  // Stub points to a missing file — distillRun.getEnvelope will throw.
  const missingStub = path.join(TMP_DATA, "does-not-exist.json");

  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });

  // Exit 0 is always returned by sb-distill (failures are soft), so use
  // spawnSync and don't check exit code.
  spawnSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: missingStub,
      SUPERBRAIN_SESSION_ID: "SID",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });

  // Distill failed — snapshot must still exist.
  expect(fs.existsSync(snapshotFile)).toBe(true);
});
