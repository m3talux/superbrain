import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, releaseLock } from "../src/lockfile";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-lock-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("lockfile", () => {
  it("grants then blocks then re-grants after release", () => {
    expect(acquireLock("distill")).toBe(true);
    expect(acquireLock("distill")).toBe(false);
    releaseLock("distill");
    expect(acquireLock("distill")).toBe(true);
  });
  it("breaks a stale lock older than maxAgeMs", () => {
    expect(acquireLock("distill")).toBe(true);
    expect(acquireLock("distill", { maxAgeMs: -1 })).toBe(true); // any age is stale
  });
});
