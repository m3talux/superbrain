import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { buildClaudeSpawnOptions } from "../src/claudeCli.js";

describe("claudeCli buildClaudeSpawnOptions", () => {
  it("returns shell: true on win32 so the .cmd shim resolves", () => {
    const opts = buildClaudeSpawnOptions("win32");
    expect(opts.shell).toBe(true);
    expect(opts.encoding).toBe("utf8");
  });
  it("does NOT set shell on darwin", () => {
    expect(buildClaudeSpawnOptions("darwin").shell).toBeUndefined();
  });
  it("does NOT set shell on linux", () => {
    expect(buildClaudeSpawnOptions("linux").shell).toBeUndefined();
  });
  it("always sets utf8 encoding", () => {
    expect(buildClaudeSpawnOptions("darwin").encoding).toBe("utf8");
    expect(buildClaudeSpawnOptions("win32").encoding).toBe("utf8");
    expect(buildClaudeSpawnOptions("linux").encoding).toBe("utf8");
  });
  it("sets a finite positive timeout so a hung claude -p cannot wedge forever", () => {
    const opts = buildClaudeSpawnOptions("darwin");
    expect(typeof opts.timeout).toBe("number");
    expect(opts.timeout!).toBeGreaterThan(0);
    expect(Number.isFinite(opts.timeout!)).toBe(true);
  });
  it("raises maxBuffer above the 1MB default for large distill output", () => {
    const opts = buildClaudeSpawnOptions("darwin");
    expect(typeof opts.maxBuffer).toBe("number");
    expect(opts.maxBuffer!).toBeGreaterThan(1024 * 1024);
  });
  it("honours SUPERBRAIN_DISTILL_TIMEOUT_MS override", () => {
    const prev = process.env.SUPERBRAIN_DISTILL_TIMEOUT_MS;
    process.env.SUPERBRAIN_DISTILL_TIMEOUT_MS = "1234";
    try {
      expect(buildClaudeSpawnOptions("darwin").timeout).toBe(1234);
    } finally {
      if (prev === undefined) delete process.env.SUPERBRAIN_DISTILL_TIMEOUT_MS;
      else process.env.SUPERBRAIN_DISTILL_TIMEOUT_MS = prev;
    }
  });
});

// Real-subprocess proof that the timeout mechanism buildClaudeSpawnOptions
// relies on actually bounds a hang: execFileSync against a busy loop must throw
// promptly rather than block forever.
describe("execFileSync timeout bounds a hung child", () => {
  it("kills a busy-loop child once the timeout elapses", () => {
    const opts = { ...buildClaudeSpawnOptions("darwin"), timeout: 200 };
    const start = Date.now();
    let threw = false;
    try {
      execFileSync(process.execPath, ["-e", "while(true){}"], opts);
    } catch (e: any) {
      threw = true;
      expect(e.killed === true || e.code === "ETIMEDOUT" || e.signal != null).toBe(true);
    }
    expect(threw).toBe(true);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
