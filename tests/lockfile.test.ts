import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { acquireLock, releaseLock } from "../src/lockfile";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-lock";
  fs.rmSync("/tmp/sb-lock", { recursive: true, force: true });
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
