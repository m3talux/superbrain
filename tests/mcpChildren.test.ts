import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let TMP: string;
beforeEach(() => { TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-mc-")); process.env.SUPERBRAIN_DATA_DIR = TMP; });
afterEach(() => { fs.rmSync(TMP, { recursive: true, force: true }); delete process.env.SUPERBRAIN_DATA_DIR; });

it("lists children with project + open threads", async () => {
  const { upsertDay } = await import("../src/dailyState.js");
  const { handleChildren } = await import("../src/mcpChildren.js");
  upsertDay("2026-06-11", "cA", { digestLine: "", routedRelPaths: [], alsoDid: [],
    openThreads: ["wire Y"], project: "alfred", parentSessionId: "P" });
  const out = await handleChildren({ parentSessionId: "P", date: "2026-06-11" });
  const text = out.content[0].text;
  expect(text).toContain("cA");
  expect(text).toContain("alfred");
  expect(text).toContain("wire Y");
});

it("blank parent or no children -> friendly message", async () => {
  const { handleChildren } = await import("../src/mcpChildren.js");
  expect((await handleChildren({ parentSessionId: "" })).content[0].text).toMatch(/no/i);
  expect((await handleChildren({ parentSessionId: "X", date: "2026-06-11" })).content[0].text).toMatch(/no/i);
});

it("defaults date to today (UTC) when omitted", async () => {
  const { upsertDay } = await import("../src/dailyState.js");
  const { handleChildren } = await import("../src/mcpChildren.js");
  const today = new Date().toISOString().slice(0, 10);
  upsertDay(today, "cT", { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: [], parentSessionId: "P" });
  expect((await handleChildren({ parentSessionId: "P" })).content[0].text).toContain("cT");
});
