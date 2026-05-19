import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { depsPresent } from "../src/bootstrap.js";

// Regression: depsPresent() must report deps ready ONLY when better-sqlite3's
// native binding actually exists — not merely when the package directory exists.
// A source-only install (no build/Release/*.node, no prebuilds/) means the
// binding was never compiled (e.g. Node ABI with no prebuild + bootstrap that
// didn't rebuild). Treating that as "ready" causes silent require() crashes.

const ROOT = "/tmp/sb-deps-binding";
const BS = path.join(ROOT, "node_modules", "better-sqlite3");

beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

it("false when better-sqlite3 is absent entirely", () => {
  fs.mkdirSync(ROOT, { recursive: true });
  expect(depsPresent(ROOT)).toBe(false);
});

it("false when better-sqlite3 is present but the native binding was never built (source-only)", () => {
  fs.mkdirSync(BS, { recursive: true });
  fs.writeFileSync(path.join(BS, "package.json"), '{"name":"better-sqlite3"}');
  // no build/Release/*.node, no prebuilds/ — this is the broken-install bug
  expect(depsPresent(ROOT)).toBe(false);
});

it("true when the compiled binding exists at build/Release/better_sqlite3.node", () => {
  const rel = path.join(BS, "build", "Release");
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "better_sqlite3.node"), "");
  expect(depsPresent(ROOT)).toBe(true);
});

it("true when a prebuilt binding is shipped under prebuilds/ (must not false-negative prebuild installs)", () => {
  const pre = path.join(BS, "prebuilds", "darwin-arm64");
  fs.mkdirSync(pre, { recursive: true });
  fs.writeFileSync(path.join(pre, "better-sqlite3.node"), "");
  expect(depsPresent(ROOT)).toBe(true);
});
