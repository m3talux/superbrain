import { it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { upsertDay, readDay, type DaySessionEntry } from "../src/dailyState";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ds-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const entry = (over: Partial<DaySessionEntry> = {}): DaySessionEntry =>
  ({ digestLine: "did things", routedRelPaths: ["decisions/a.md"], alsoDid: ["debugged X"], openThreads: ["finish Y"], ...over });

it("upserts and reads back, keyed by sessionId", () => {
  upsertDay("2026-05-19", "S1", entry());
  upsertDay("2026-05-19", "S2", entry({ digestLine: "s2" }));
  const d = readDay("2026-05-19");
  expect(Object.keys(d)).toEqual(["S1", "S2"]);
  expect(d.S2.digestLine).toBe("s2");
});

it("re-upserting the same session overwrites (no duplication)", () => {
  upsertDay("2026-05-19", "S1", entry({ routedRelPaths: ["a.md"] }));
  upsertDay("2026-05-19", "S1", entry({ routedRelPaths: ["a.md", "b.md"] }));
  const d = readDay("2026-05-19");
  expect(Object.keys(d)).toEqual(["S1"]);
  expect(d.S1.routedRelPaths).toEqual(["a.md", "b.md"]);
});

it("readDay returns {} for an unknown date", () => {
  expect(readDay("2099-01-01")).toEqual({});
});

it("preserves the prior day file when a write is interrupted mid-flight", () => {
  upsertDay("2026-05-19", "S1", entry());
  const f = path.join(TMP, "daily", "2026-05-19.json");
  const before = fs.readFileSync(f, "utf8");

  // atomicWrite stages content into a temp file (fs.writeSync) then renames; a
  // crash there must leave the original intact, never a truncated JSON that
  // readDay would silently swallow as {}. A plain in-place writeFileSync cannot
  // offer this — the target is truncated before the failing write.
  const spy = vi.spyOn(fs, "writeSync").mockImplementationOnce(() => { throw new Error("ENOSPC"); });
  expect(() => upsertDay("2026-05-19", "S2", entry({ digestLine: "s2" }))).toThrow();
  spy.mockRestore();

  const after = fs.readFileSync(f, "utf8");
  expect(after).toBe(before);
  expect(() => JSON.parse(after)).not.toThrow();
  expect(Object.keys(readDay("2026-05-19"))).toEqual(["S1"]);
});
