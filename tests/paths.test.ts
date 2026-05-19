import { describe, it, expect, beforeEach } from "vitest";
import * as P from "../src/paths";

describe("paths", () => {
  beforeEach(() => {
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-test-data";
    process.env.SUPERBRAIN_VAULT = "/tmp/sb-test-vault";
  });
  it("derives data + vault + session paths", () => {
    expect(P.dataDir()).toBe("/tmp/sb-test-data");
    expect(P.vaultPath()).toBe("/tmp/sb-test-vault");
    expect(P.sessionNdjsonPath("abc")).toBe("/tmp/sb-test-data/sessions/abc.ndjson");
    expect(P.cursorPath("abc")).toBe("/tmp/sb-test-data/sessions/abc.cursor");
    expect(P.sentinelPath()).toBe("/tmp/sb-test-data/last-failure.txt");
    expect(P.rollupStatePath()).toBe("/tmp/sb-test-data/rollup-state.json");
    expect(P.lockDir("distill")).toBe("/tmp/sb-test-data/locks/distill.lock");
  });
  it("falls back to ~/.superbrain and ~/vault", () => {
    delete process.env.CLAUDE_PLUGIN_DATA;
    delete process.env.SUPERBRAIN_VAULT;
    expect(P.dataDir()).toMatch(/\.superbrain$/);
    expect(P.vaultPath()).toMatch(/(vault|Documents\/SuperBrain)$/);
  });
});
