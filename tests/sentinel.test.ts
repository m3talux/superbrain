import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFailure, readAndClearFailure } from "../src/sentinel";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sentinel-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("sentinel", () => {
  it("returns null when no failure", () => {
    expect(readAndClearFailure()).toBeNull();
  });
  it("stores then clears a failure exactly once", () => {
    writeFailure("distill auth failed");
    const got = readAndClearFailure();
    expect(got).toContain("distill auth failed");
    expect(readAndClearFailure()).toBeNull();
  });
});
