import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { sha256, atomicWrite, readWithChecksum } from "../src/atomicWrite";

const F = "/tmp/sb-aw/n.md";
beforeEach(() => { fs.rmSync("/tmp/sb-aw", { recursive: true, force: true }); });

describe("atomicWrite", () => {
  it("writes then reads back with stable checksum", () => {
    atomicWrite(F, "hello");
    const r = readWithChecksum(F);
    expect(r?.content).toBe("hello");
    expect(r?.checksum).toBe(sha256("hello"));
  });
  it("returns null for missing file", () => {
    expect(readWithChecksum("/tmp/sb-aw/missing.md")).toBeNull();
  });
  it("overwrites atomically (no temp file left behind)", () => {
    atomicWrite(F, "a"); atomicWrite(F, "b");
    expect(readWithChecksum(F)?.content).toBe("b");
    expect(fs.readdirSync("/tmp/sb-aw").filter((x) => x.includes("tmp"))).toEqual([]);
  });
});
