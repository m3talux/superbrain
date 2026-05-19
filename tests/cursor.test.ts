import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { readCursor, writeCursor } from "../src/cursor";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-cursor";
  fs.rmSync("/tmp/sb-cursor", { recursive: true, force: true });
});

describe("cursor", () => {
  it("defaults to 0 then round-trips", () => {
    expect(readCursor("s")).toBe(0);
    writeCursor("s", 42);
    expect(readCursor("s")).toBe(42);
  });
  it("treats corrupt cursor as 0", () => {
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-cursor";
    writeCursor("s", 10);
    fs.writeFileSync("/tmp/sb-cursor/sessions/s.cursor", "garbage");
    expect(readCursor("s")).toBe(0);
  });
});
