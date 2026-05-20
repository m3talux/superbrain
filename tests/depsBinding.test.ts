import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { depsPresent } from "../src/bootstrap.js";

// Regression: depsPresent() must report deps ready ONLY when better-sqlite3's
// native binding actually exists — not merely when the package directory exists.
// A source-only install (no build/Release/*.node, no prebuilds/) means the
// binding was never compiled (e.g. Node ABI with no prebuild + bootstrap that
// didn't rebuild). Treating that as "ready" causes silent require() crashes.

let ROOT: string;

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-deps-binding-"));
});

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

it("false when better-sqlite3 is absent entirely", () => {
  expect(depsPresent(ROOT)).toBe(false);
});

it("false when better-sqlite3 is present but the native binding was never built (source-only)", () => {
  const BS = path.join(ROOT, "node_modules", "better-sqlite3");
  fs.mkdirSync(BS, { recursive: true });
  fs.writeFileSync(path.join(BS, "package.json"), '{"name":"better-sqlite3"}');
  // no build/Release/*.node, no prebuilds/ — this is the broken-install bug
  expect(depsPresent(ROOT)).toBe(false);
});

it("true when the compiled binding exists at build/Release/better_sqlite3.node", () => {
  const BS = path.join(ROOT, "node_modules", "better-sqlite3");
  const rel = path.join(BS, "build", "Release");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "better_sqlite3.node"), "");
  expect(depsPresent(ROOT)).toBe(true);
});

it("true when a prebuilt binding is shipped under prebuilds/ (must not false-negative prebuild installs)", () => {
  const BS = path.join(ROOT, "node_modules", "better-sqlite3");
  const pre = path.join(BS, "prebuilds", "darwin-arm64");
  fs.mkdirSync(pre, { recursive: true });
  fs.writeFileSync(path.join(pre, "better-sqlite3.node"), "");
  expect(depsPresent(ROOT)).toBe(true);
});
