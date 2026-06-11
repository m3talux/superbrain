import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listOrphanedSessions } from "../src/distillSweep.js";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-orph-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-orph-vault-"));
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
});
afterEach(() => {
  delete process.env.SUPERBRAIN_DATA_DIR;
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function eventLine(): string {
  return JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n";
}

function makeSession(sid: string, opts?: { cursorAtTip?: boolean; ageMs?: number }): void {
  const p = path.join(TMP_DATA, "sessions", `${sid}.ndjson`);
  fs.writeFileSync(p, eventLine());
  if (opts?.cursorAtTip) {
    fs.writeFileSync(path.join(TMP_DATA, "sessions", `${sid}.cursor`), String(fs.statSync(p).size));
  }
  if (opts?.ageMs) {
    const t = (Date.now() - opts.ageMs) / 1000;
    fs.utimesSync(p, t, t);
  }
}

it("stale session with undistilled bytes is an orphan", () => {
  makeSession("A", { ageMs: 4 * 3_600_000 });
  expect(listOrphanedSessions("HOST")).toEqual(["A"]);
});

it("fresh sessions, fully-distilled sessions, and the current session are not orphans", () => {
  makeSession("FRESH");
  makeSession("DONE", { cursorAtTip: true, ageMs: 4 * 3_600_000 });
  makeSession("ME", { ageMs: 4 * 3_600_000 });
  expect(listOrphanedSessions("ME")).toEqual([]);
});

it("idle threshold is configurable via opts", () => {
  makeSession("B", { ageMs: 60_000 });
  expect(listOrphanedSessions("HOST", { maxIdleMs: 0 })).toEqual(["B"]);
  expect(listOrphanedSessions("HOST", { maxIdleMs: 3_600_000 })).toEqual([]);
});

it("sb-reconcile distills an orphaned session end to end", () => {
  makeSession("ORPH");
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify({
    items: [
      { kind: "decision", title: "Pick X", project: "test",
        body: "## Decision\nPick X.\n## Why\n- Best fit.\n## Alternatives considered\n- **Alt A** — rejected because cost.\n## Consequences\n- Trade-offs apply.",
        date: "2026-06-11", links: [] },
    ],
    digest: "orphan digest",
  }));
  execFileSync("npx", ["tsx", "bin/sb-reconcile.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_EMBED_STUB: "1",
      SUPERBRAIN_SESSION_ID: "HOST",
      SUPERBRAIN_ORPHAN_IDLE_HOURS: "0",
      SUPERBRAIN_GC_DISABLE: "1",
    },
    encoding: "utf8",
  });
  const ndjson = path.join(TMP_DATA, "sessions/ORPH.ndjson");
  const cursor = path.join(TMP_DATA, "sessions/ORPH.cursor");
  expect(fs.existsSync(cursor)).toBe(true);
  expect(parseInt(fs.readFileSync(cursor, "utf8").trim(), 10)).toBe(fs.statSync(ndjson).size);
});
