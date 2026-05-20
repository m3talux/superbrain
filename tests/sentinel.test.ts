import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { writeFailure, readAndClearFailure } from "../src/sentinel";

beforeEach(() => {
  process.env.SUPERBRAIN_DATA_DIR = "/tmp/sb-sentinel";
  fs.rmSync("/tmp/sb-sentinel", { recursive: true, force: true });
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
