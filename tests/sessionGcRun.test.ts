import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSessionGcOncePerDay } from "../src/sessionGcRun.js";

let TMP: string;
const STAMP = "session-gc.stamp";

function sessDir(base: string): string {
  return path.join(base, "sessions");
}
function makeSessionFile(dir: string, name: string, mtime: Date): void {
  const p = path.join(dir, name);
  fs.writeFileSync(p, "");
  fs.utimesSync(p, mtime, mtime);
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

const GC_ENV = [
  "SUPERBRAIN_GC_MAX_AGE_DAYS",
  "SUPERBRAIN_GC_MIN_INTERVAL_HOURS",
  "SUPERBRAIN_GC_DRY_RUN",
  "SUPERBRAIN_GC_DISABLE",
];

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sbgcrun-"));
  fs.mkdirSync(sessDir(TMP), { recursive: true });
  for (const k of GC_ENV) delete process.env[k];
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const k of GC_ENV) delete process.env[k];
});

describe("runSessionGcOncePerDay", () => {
  it("runs and writes stamp on first invocation", () => {
    const sid = "s-first";
    makeSessionFile(sessDir(TMP), `${sid}.ndjson`, daysAgo(40));
    const r = runSessionGcOncePerDay(TMP);
    expect(r.ran).toBe(true);
    expect(r.skippedByCadence).toBe(false);
    expect(fs.existsSync(path.join(TMP, STAMP))).toBe(true);
    expect(fs.existsSync(path.join(sessDir(TMP), `${sid}.ndjson`))).toBe(false);
  });

  it("skips when stamp is fresh (cadence guard)", () => {
    const sid = "s-fresh-stamp";
    makeSessionFile(sessDir(TMP), `${sid}.ndjson`, daysAgo(40));
    fs.writeFileSync(path.join(TMP, STAMP), "x");
    const r = runSessionGcOncePerDay(TMP);
    expect(r.ran).toBe(false);
    expect(r.skippedByCadence).toBe(true);
    expect(fs.existsSync(path.join(sessDir(TMP), `${sid}.ndjson`))).toBe(true);
  });

  it("runs again once the stamp is older than the interval", () => {
    const sid = "s-stale-stamp";
    makeSessionFile(sessDir(TMP), `${sid}.ndjson`, daysAgo(40));
    const stampPath = path.join(TMP, STAMP);
    fs.writeFileSync(stampPath, "x");
    const old = daysAgo(2);
    fs.utimesSync(stampPath, old, old);
    const r = runSessionGcOncePerDay(TMP);
    expect(r.ran).toBe(true);
    expect(fs.existsSync(path.join(sessDir(TMP), `${sid}.ndjson`))).toBe(false);
  });

  it("deletes 31-day-old group and keeps 5-day-old group with default age", () => {
    const oldSid = "s-old";
    const freshSid = "s-recent";
    makeSessionFile(sessDir(TMP), `${oldSid}.ndjson`, daysAgo(31));
    makeSessionFile(sessDir(TMP), `${oldSid}.cursor`, daysAgo(31));
    makeSessionFile(sessDir(TMP), `${freshSid}.ndjson`, daysAgo(5));
    runSessionGcOncePerDay(TMP);
    expect(fs.existsSync(path.join(sessDir(TMP), `${oldSid}.ndjson`))).toBe(false);
    expect(fs.existsSync(path.join(sessDir(TMP), `${freshSid}.ndjson`))).toBe(true);
  });

  it("honors SUPERBRAIN_GC_MAX_AGE_DAYS override", () => {
    process.env.SUPERBRAIN_GC_MAX_AGE_DAYS = "7";
    const sid = "s-10d";
    makeSessionFile(sessDir(TMP), `${sid}.ndjson`, daysAgo(10));
    runSessionGcOncePerDay(TMP);
    expect(fs.existsSync(path.join(sessDir(TMP), `${sid}.ndjson`))).toBe(false);
  });

  it("honors SUPERBRAIN_GC_MIN_INTERVAL_HOURS override", () => {
    process.env.SUPERBRAIN_GC_MIN_INTERVAL_HOURS = "0";
    const sid = "s-interval0";
    makeSessionFile(sessDir(TMP), `${sid}.ndjson`, daysAgo(40));
    const first = runSessionGcOncePerDay(TMP);
    expect(first.ran).toBe(true);
    makeSessionFile(sessDir(TMP), `${sid}-b.ndjson`, daysAgo(40));
    const second = runSessionGcOncePerDay(TMP);
    expect(second.ran).toBe(true);
    expect(second.skippedByCadence).toBe(false);
  });

  it("dry-run reports deletions without removing files", () => {
    process.env.SUPERBRAIN_GC_DRY_RUN = "1";
    const sid = "s-dry";
    makeSessionFile(sessDir(TMP), `${sid}.ndjson`, daysAgo(40));
    const r = runSessionGcOncePerDay(TMP);
    expect(r.ran).toBe(true);
    expect(r.result!.deleted.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(sessDir(TMP), `${sid}.ndjson`))).toBe(true);
    expect(fs.existsSync(path.join(TMP, STAMP))).toBe(true);
  });

  it("SUPERBRAIN_GC_DISABLE=1 disables GC entirely", () => {
    process.env.SUPERBRAIN_GC_DISABLE = "1";
    const sid = "s-disabled";
    makeSessionFile(sessDir(TMP), `${sid}.ndjson`, daysAgo(40));
    const r = runSessionGcOncePerDay(TMP);
    expect(r.ran).toBe(false);
    expect(r.skippedByCadence).toBe(false);
    expect(fs.existsSync(path.join(sessDir(TMP), `${sid}.ndjson`))).toBe(true);
    expect(fs.existsSync(path.join(TMP, STAMP))).toBe(false);
  });

  it("never deletes or modifies any .md note", () => {
    const vault = path.join(TMP, "vault");
    fs.mkdirSync(vault, { recursive: true });
    const note = path.join(vault, "My Note.md");
    fs.writeFileSync(note, "# Hand-authored\nimportant\n");
    const strayMd = path.join(TMP, "README.md");
    fs.writeFileSync(strayMd, "stray\n");

    const old = daysAgo(40);
    fs.utimesSync(note, old, old);
    fs.utimesSync(strayMd, old, old);

    makeSessionFile(sessDir(TMP), "s-vaultsafe.ndjson", old);

    const before = {
      note: { body: fs.readFileSync(note, "utf8"), mtime: fs.statSync(note).mtimeMs },
      stray: { body: fs.readFileSync(strayMd, "utf8"), mtime: fs.statSync(strayMd).mtimeMs },
    };

    runSessionGcOncePerDay(TMP);

    expect(fs.existsSync(note)).toBe(true);
    expect(fs.existsSync(strayMd)).toBe(true);
    expect(fs.readFileSync(note, "utf8")).toBe(before.note.body);
    expect(fs.readFileSync(strayMd, "utf8")).toBe(before.stray.body);
    expect(fs.statSync(note).mtimeMs).toBe(before.note.mtime);
    expect(fs.statSync(strayMd).mtimeMs).toBe(before.stray.mtime);
    expect(fs.existsSync(path.join(sessDir(TMP), "s-vaultsafe.ndjson"))).toBe(false);
  });
});
