import { it, expect, beforeEach, afterEach } from "vitest";
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
