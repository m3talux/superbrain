import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCheapUpgradeSteps, upgradeSentinelPath } from "../src/autoUpgrade.js";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-au-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-au-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
});

describe("upgradeSentinelPath", () => {
  it("returns a path under dataDir containing the version", () => {
    const p = upgradeSentinelPath(TMP_DATA, "0.7.0");
    expect(p).toContain(TMP_DATA);
    expect(p).toContain("0.7.0");
  });
});

describe("runCheapUpgradeSteps", () => {
  it("runs once on first call and creates the sentinel", async () => {
    const version = "0.7.0";
    const sentinel = upgradeSentinelPath(TMP_DATA, version);
    expect(fs.existsSync(sentinel)).toBe(false);

    await runCheapUpgradeSteps(TMP_DATA, version);

    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it("is a no-op on the second call (sentinel already exists)", async () => {
    const version = "0.7.0";
    await runCheapUpgradeSteps(TMP_DATA, version);

    const sentinel = upgradeSentinelPath(TMP_DATA, version);
    const mtime1 = fs.statSync(sentinel).mtimeMs;

    await runCheapUpgradeSteps(TMP_DATA, version);

    const mtime2 = fs.statSync(sentinel).mtimeMs;
    expect(mtime2).toBe(mtime1);
  });

  it("runs again for a different version (different sentinel)", async () => {
    await runCheapUpgradeSteps(TMP_DATA, "0.6.0");
    const sentinel07 = upgradeSentinelPath(TMP_DATA, "0.7.0");
    expect(fs.existsSync(sentinel07)).toBe(false);

    await runCheapUpgradeSteps(TMP_DATA, "0.7.0");
    expect(fs.existsSync(sentinel07)).toBe(true);
  });
});
