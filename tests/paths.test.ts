import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as P from "../src/paths";

let TMP_DATA: string;
let TMP_VAULT: string;

describe("paths", () => {
  beforeEach(() => {
    TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-data-"));
    TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-vault-"));
    process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
    process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  });

  afterEach(() => {
    fs.rmSync(TMP_DATA, { recursive: true, force: true });
    fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  });

  it("derives data + vault + session paths", () => {
    expect(P.dataDir()).toBe(TMP_DATA);
    expect(P.vaultPath()).toBe(TMP_VAULT);
    expect(P.sessionNdjsonPath("abc")).toBe(path.join(TMP_DATA, "sessions/abc.ndjson"));
    expect(P.cursorPath("abc")).toBe(path.join(TMP_DATA, "sessions/abc.cursor"));
    expect(P.sentinelPath()).toBe(path.join(TMP_DATA, "last-failure.txt"));

    expect(P.lockDir("distill")).toBe(path.join(TMP_DATA, "locks/distill.lock"));
  });
  it("falls back to ~/.superbrain and ~/vault", () => {
    delete process.env.SUPERBRAIN_DATA_DIR;
    delete process.env.SUPERBRAIN_VAULT_DIR;
    expect(P.dataDir()).toMatch(/\.superbrain$/);
    expect(P.vaultPath()).toMatch(/(vault|Documents\/SuperBrain)$/);
  });
});
