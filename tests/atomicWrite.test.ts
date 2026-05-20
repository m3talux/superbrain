import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256, atomicWrite, readWithChecksum } from "../src/atomicWrite";

let TMP: string;
let F: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-aw-"));
  F = path.join(TMP, "n.md");
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  it("writes then reads back with stable checksum", () => {
    atomicWrite(F, "hello");
    const r = readWithChecksum(F);
    expect(r?.content).toBe("hello");
    expect(r?.checksum).toBe(sha256("hello"));
  });
  it("returns null for missing file", () => {
    expect(readWithChecksum(path.join(TMP, "missing.md"))).toBeNull();
  });
  it("overwrites atomically (no temp file left behind)", () => {
    atomicWrite(F, "a"); atomicWrite(F, "b");
    expect(readWithChecksum(F)?.content).toBe("b");
    expect(fs.readdirSync(TMP).filter((x) => x.includes("tmp"))).toEqual([]);
  });
});
