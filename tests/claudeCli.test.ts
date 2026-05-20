import { describe, it, expect } from "vitest";
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
});
