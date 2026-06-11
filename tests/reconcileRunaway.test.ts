import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildClaudePInvocation } from "../src/claudeCli.js";
import { listOrphanedSessions, readAttempts, MAX_DISTILL_ATTEMPTS } from "../src/distillSweep.js";
import { sweepOrphanedSessions } from "../src/distillRun.js";
import { shouldSpawnReconcile, RECONCILE_DEBOUNCE_MS } from "../src/reconcileGate.js";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-runaway-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-runaway-vault-"));
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
});
afterEach(() => {
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_VAULT_DIR;
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function makeOrphan(sid: string): string {
  const p = path.join(TMP_DATA, "sessions", `${sid}.ndjson`);
  fs.writeFileSync(p, JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const t = (Date.now() - 4 * 3_600_000) / 1000;
  fs.utimesSync(p, t, t);
  return p;
}

it("distill prompt travels via stdin, never argv (E2BIG)", () => {
  const huge = "x".repeat(2_000_000);
  const { args, options } = buildClaudePInvocation(huge, "darwin");
  expect(options.input).toBe(huge);
  for (const a of args) expect(a.length).toBeLessThan(1000);
  expect(args[args.length - 1]).toBe("-p");
});

it("a permanently failing orphan is retried at most MAX_DISTILL_ATTEMPTS times, then marked processed", async () => {
  const ndjson = makeOrphan("POISON");
  let calls = 0;
  const failing = async (_sid: string) => { calls++; throw new Error("E2BIG"); };

  for (let i = 0; i < MAX_DISTILL_ATTEMPTS; i++) {
    await sweepOrphanedSessions("HOST", failing);
  }
  expect(calls).toBe(MAX_DISTILL_ATTEMPTS);

  const cursor = path.join(TMP_DATA, "sessions", "POISON.cursor");
  expect(parseInt(fs.readFileSync(cursor, "utf8").trim(), 10)).toBe(fs.statSync(ndjson).size);

  await sweepOrphanedSessions("HOST", failing);
  expect(calls).toBe(MAX_DISTILL_ATTEMPTS);
});

it("attempt counter survives across sweeps and is cleared on success", async () => {
  makeOrphan("FLAKY");
  let calls = 0;
  const flaky = async (_sid: string) => { calls++; if (calls === 1) throw new Error("transient"); };

  await sweepOrphanedSessions("HOST", flaky);
  expect(readAttempts("FLAKY")).toBe(1);

  await sweepOrphanedSessions("HOST", flaky);
  expect(calls).toBe(2);
  expect(readAttempts("FLAKY")).toBe(0);
  expect(fs.existsSync(path.join(TMP_DATA, "sessions", "FLAKY.distill-attempts"))).toBe(false);
});

it("orphans at the attempt ceiling are not even listed", () => {
  makeOrphan("CAPPED");
  fs.writeFileSync(path.join(TMP_DATA, "sessions", "CAPPED.distill-attempts"), String(MAX_DISTILL_ATTEMPTS));
  expect(listOrphanedSessions("HOST")).toEqual([]);
});

it("reconcile spawn is debounced within the window", () => {
  const now = Date.now();
  expect(shouldSpawnReconcile(TMP_DATA, now)).toBe(true);
  expect(shouldSpawnReconcile(TMP_DATA, now + 1000)).toBe(false);
  expect(shouldSpawnReconcile(TMP_DATA, now + RECONCILE_DEBOUNCE_MS + 1000)).toBe(true);
});

it("a second sb-reconcile is a no-op while the first holds the reconcile lock", () => {
  makeOrphan("ORPH");
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify({
    items: [], digest: "orphan digest",
  }));
  const env = {
    ...process.env,
    SUPERBRAIN_DATA_DIR: TMP_DATA,
    SUPERBRAIN_VAULT_DIR: TMP_VAULT,
    SUPERBRAIN_DISTILL_STUB: stub,
    SUPERBRAIN_EMBED_STUB: "1",
    SUPERBRAIN_SESSION_ID: "HOST",
    SUPERBRAIN_ORPHAN_IDLE_HOURS: "0",
    SUPERBRAIN_GC_DISABLE: "1",
  };

  const lockDir = path.join(TMP_DATA, "locks", "reconcile.lock");
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "pid"), "99999");
  fs.writeFileSync(path.join(lockDir, "token"), "held-elsewhere");

  execFileSync("npx", ["tsx", "bin/sb-reconcile.ts"], { env, encoding: "utf8" });
  expect(fs.existsSync(path.join(TMP_DATA, "sessions", "ORPH.cursor"))).toBe(false);

  fs.rmSync(lockDir, { recursive: true, force: true });
  execFileSync("npx", ["tsx", "bin/sb-reconcile.ts"], { env, encoding: "utf8" });
  const ndjson = path.join(TMP_DATA, "sessions", "ORPH.ndjson");
  const cursor = path.join(TMP_DATA, "sessions", "ORPH.cursor");
  expect(parseInt(fs.readFileSync(cursor, "utf8").trim(), 10)).toBe(fs.statSync(ndjson).size);
  expect(fs.existsSync(path.join(TMP_DATA, "locks", "reconcile.lock"))).toBe(false);
});
