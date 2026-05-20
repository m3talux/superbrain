import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultPath, pluginRoot } from "../src/paths";
import { setRecordedVaultPath, isOwned } from "../src/vaultMarker";

let TMP_DATA: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pr-data-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.CLAUDE_PLUGIN_ROOT;
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

it("SUPERBRAIN_VAULT_DIR wins and is marked", () => {
  const explicitVault = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pr-explicit-"));
  try {
    process.env.SUPERBRAIN_VAULT_DIR = explicitVault;
    expect(vaultPath()).toBe(explicitVault);
    expect(isOwned(explicitVault)).toBe(true);
  } finally {
    fs.rmSync(explicitVault, { recursive: true, force: true });
  }
});

it("recorded adopted path is used when no env", () => {
  const adoptedVault = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pr-adopted-"));
  try {
    setRecordedVaultPath(adoptedVault);
    expect(vaultPath()).toBe(adoptedVault);
  } finally {
    fs.rmSync(adoptedVault, { recursive: true, force: true });
  }
});

it("owned default is dataDir/vault, created + marked; never ~/vault", () => {
  const home = os.homedir();
  const v = vaultPath();
  expect(v).toBe(path.join(TMP_DATA, "vault"));
  expect(v).not.toBe(path.join(home, "vault"));
  expect(isOwned(v)).toBe(true);
});

it("pluginRoot honors CLAUDE_PLUGIN_ROOT", () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pr-root-"));
  try {
    process.env.CLAUDE_PLUGIN_ROOT = pluginDir;
    expect(pluginRoot()).toBe(pluginDir);
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});
