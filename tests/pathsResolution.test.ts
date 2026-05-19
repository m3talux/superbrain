import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultPath, pluginRoot } from "../src/paths";
import { setRecordedVaultPath, isOwned } from "../src/vaultMarker";

beforeEach(() => {
  fs.rmSync("/tmp/sb-pr-data", { recursive: true, force: true });
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-pr-data";
  delete process.env.SUPERBRAIN_VAULT;
  delete process.env.CLAUDE_PLUGIN_ROOT;
});

it("SUPERBRAIN_VAULT wins and is marked", () => {
  fs.mkdirSync("/tmp/sb-pr-explicit", { recursive: true });
  process.env.SUPERBRAIN_VAULT = "/tmp/sb-pr-explicit";
  expect(vaultPath()).toBe("/tmp/sb-pr-explicit");
  expect(isOwned("/tmp/sb-pr-explicit")).toBe(true);
});

it("recorded adopted path is used when no env", () => {
  fs.mkdirSync("/tmp/sb-pr-adopted", { recursive: true });
  setRecordedVaultPath("/tmp/sb-pr-adopted");
  expect(vaultPath()).toBe("/tmp/sb-pr-adopted");
});

it("owned default is dataDir/vault, created + marked; never ~/vault", () => {
  const home = os.homedir();
  const v = vaultPath();
  expect(v).toBe(path.join("/tmp/sb-pr-data", "vault"));
  expect(v).not.toBe(path.join(home, "vault"));
  expect(isOwned(v)).toBe(true);
});

it("pluginRoot honors CLAUDE_PLUGIN_ROOT", () => {
  process.env.CLAUDE_PLUGIN_ROOT = "/tmp/sb-pr-root";
  expect(pluginRoot()).toBe("/tmp/sb-pr-root");
});
