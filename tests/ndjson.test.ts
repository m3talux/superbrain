import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendEvent, readDelta } from "../src/ndjson";

const SID = "sess1";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ndjson-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
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
