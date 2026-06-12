import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCursor, writeCursor } from "../src/cursor";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cursor-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("cursor", () => {
  it("defaults to 0 then round-trips", () => {
    expect(readCursor("s")).toBe(0);
    writeCursor("s", 42);
    expect(readCursor("s")).toBe(42);
  });
  it("treats corrupt cursor as 0", () => {
    writeCursor("s", 10);
    fs.writeFileSync(path.join(TMP, "sessions/s.cursor"), "garbage");
    expect(readCursor("s")).toBe(0);
  });
  it("preserves the prior cursor when a write is interrupted mid-flight", () => {
    writeCursor("s", 4096);
    // A truncated cursor reads back as 0, which reprocesses the whole session;
    // an atomic write keeps the old offset intact when the new write fails.
    const spy = vi.spyOn(fs, "writeSync").mockImplementationOnce(() => { throw new Error("ENOSPC"); });
    expect(() => writeCursor("s", 8192)).toThrow();
    spy.mockRestore();
    expect(readCursor("s")).toBe(4096);
  });
});
