import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { appendEvent, readDelta } from "../src/ndjson";

const SID = "sess1";
beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-ndjson";
  fs.rmSync("/tmp/sb-ndjson", { recursive: true, force: true });
});

describe("ndjson", () => {
  it("appends and reads full delta from offset 0", () => {
    appendEvent(SID, { t: "a" });
    appendEvent(SID, { t: "b" });
    const d = readDelta(SID, 0);
    expect(d.events).toEqual([{ t: "a" }, { t: "b" }]);
    expect(d.newOffset).toBeGreaterThan(0);
  });
  it("reads only events after a prior offset", () => {
    appendEvent(SID, { t: "a" });
    const first = readDelta(SID, 0);
    appendEvent(SID, { t: "b" });
    const d = readDelta(SID, first.newOffset);
    expect(d.events).toEqual([{ t: "b" }]);
  });
  it("returns empty when no file", () => {
    expect(readDelta("missing", 0)).toEqual({ events: [], newOffset: 0 });
  });
});
