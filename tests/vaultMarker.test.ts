import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MARKER, isOwned, markOwned, recordedVaultPath, setRecordedVaultPath } from "../src/vaultMarker";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-vm-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-vm-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("markOwned writes the marker; isOwned detects it", () => {
  expect(isOwned(TMP_VAULT)).toBe(false);
  markOwned(TMP_VAULT);
  expect(fs.existsSync(path.join(TMP_VAULT, MARKER))).toBe(true);
  expect(isOwned(TMP_VAULT)).toBe(true);
});

it("recorded vault path round-trips and is undefined when unset", () => {
  expect(recordedVaultPath()).toBeUndefined();
  setRecordedVaultPath(TMP_VAULT);
  expect(recordedVaultPath()).toBe(TMP_VAULT);
});
