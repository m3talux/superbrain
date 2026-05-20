import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
});
