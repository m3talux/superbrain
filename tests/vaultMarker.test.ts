import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { MARKER, isOwned, markOwned, recordedVaultPath, setRecordedVaultPath } from "../src/vaultMarker";

beforeEach(() => {
  fs.rmSync("/tmp/sb-vm", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-vm-data", { recursive: true, force: true });
  process.env.SUPERBRAIN_DATA_DIR = "/tmp/sb-vm-data";
});

it("markOwned writes the marker; isOwned detects it", () => {
  fs.mkdirSync("/tmp/sb-vm", { recursive: true });
  expect(isOwned("/tmp/sb-vm")).toBe(false);
  markOwned("/tmp/sb-vm");
  expect(fs.existsSync(`/tmp/sb-vm/${MARKER}`)).toBe(true);
  expect(isOwned("/tmp/sb-vm")).toBe(true);
});

it("recorded vault path round-trips and is undefined when unset", () => {
  expect(recordedVaultPath()).toBeUndefined();
  setRecordedVaultPath("/tmp/sb-vm");
  expect(recordedVaultPath()).toBe("/tmp/sb-vm");
});
