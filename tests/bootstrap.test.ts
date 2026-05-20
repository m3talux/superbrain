import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { depsPresent, bootstrapDone, markBootstrapDone } from "../src/bootstrap";
import { platformHint } from "../bin/sb-bootstrap";

let TMP_PLUGIN: string;
let TMP_DATA: string;

beforeEach(() => {
  TMP_PLUGIN = fs.mkdtempSync(path.join(os.tmpdir(), "sb-bs-plugin-"));
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-bs-data-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
});

afterEach(() => {
  fs.rmSync(TMP_PLUGIN, { recursive: true, force: true });
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

it("depsPresent is false without the better-sqlite3 native binding, true with it", () => {
  expect(depsPresent(TMP_PLUGIN)).toBe(false);
  // package directory alone is NOT enough — a source-only install (no compiled
  // .node) must read as not-ready, or entrypoints crash silently on require().
  fs.mkdirSync(path.join(TMP_PLUGIN, "node_modules/better-sqlite3"), { recursive: true });
  expect(depsPresent(TMP_PLUGIN)).toBe(false);
  // with the compiled native binding present → ready
  fs.mkdirSync(path.join(TMP_PLUGIN, "node_modules/better-sqlite3/build/Release"), { recursive: true });
  fs.writeFileSync(path.join(TMP_PLUGIN, "node_modules/better-sqlite3/build/Release/better_sqlite3.node"), "");
  expect(depsPresent(TMP_PLUGIN)).toBe(true);
});

it("bootstrapDone reflects the per-install marker", () => {
  expect(bootstrapDone(TMP_PLUGIN)).toBe(false);
  markBootstrapDone(TMP_PLUGIN);
  expect(bootstrapDone(TMP_PLUGIN)).toBe(true);
  // A different install dir must have its own independent sentinel — that's
  // the whole point of moving bootstrap-done per-install.
  const otherPlugin = fs.mkdtempSync(path.join(os.tmpdir(), "sb-bs-other-"));
  try {
    expect(bootstrapDone(otherPlugin)).toBe(false);
  } finally {
    fs.rmSync(otherPlugin, { recursive: true, force: true });
  }
});

it("sb-bootstrap is idempotent only when BOTH sentinel exists AND deps present", () => {
  markBootstrapDone(TMP_PLUGIN);
  // Without the native binding, sentinel alone is not enough — bootstrap must
  // still run to rebuild. Stage a fake binding so the conjoined check passes.
  fs.mkdirSync(path.join(TMP_PLUGIN, "node_modules/better-sqlite3/build/Release"), { recursive: true });
  fs.writeFileSync(path.join(TMP_PLUGIN, "node_modules/better-sqlite3/build/Release/better_sqlite3.node"), "");
  const out = execFileSync("npx", ["tsx", "bin/sb-bootstrap.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_PLUGIN_ROOT: TMP_PLUGIN, SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/already done/);
});

it("sb-bootstrap (fake) writes per-install bootstrap-done on success", () => {
  execFileSync("npx", ["tsx", "bin/sb-bootstrap.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_PLUGIN_ROOT: TMP_PLUGIN, SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(bootstrapDone(TMP_PLUGIN)).toBe(true);
});

it("sb-bootstrap re-runs when sentinel exists but native binding is missing (upgrade self-heal)", () => {
  // Simulates the Node 25 / 0.3.0 trap: stale sentinel from a previous install
  // survives into a new plugin version dir that has no .node binary yet.
  // Old code would short-circuit on sentinel and leave deps broken forever.
  // New code re-runs because the conjoined check fails.
  markBootstrapDone(TMP_PLUGIN);
  // No better-sqlite3 native binding staged — depsPresent is false.
  const out = execFileSync("npx", ["tsx", "bin/sb-bootstrap.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_PLUGIN_ROOT: TMP_PLUGIN, SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(out).not.toMatch(/already done/);
});

it("platformHint returns a non-empty string for known platforms and empty string for unknown", () => {
  // We can't control process.platform at test time, so verify the contract:
  // known platforms (win32, linux, darwin) have hint text; unknown platforms don't.
  const knownHints: Record<string, string> = {
    win32: "Visual Studio Build Tools",
    linux: "build-essential",
    darwin: "xcode-select",
  };
  const current = process.platform as string;
  const hint = platformHint();
  if (current in knownHints) {
    expect(hint).toContain(knownHints[current]);
  } else {
    expect(hint).toBe("");
  }
});
