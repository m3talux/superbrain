import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { depsPresent, bootstrapDone, markBootstrapDone } from "../src/bootstrap";

beforeEach(() => {
  fs.rmSync("/tmp/sb-bs", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-bs-data", { recursive: true, force: true });
  process.env.SUPERBRAIN_DATA_DIR = "/tmp/sb-bs-data";
});

it("depsPresent is false without the better-sqlite3 native binding, true with it", () => {
  fs.mkdirSync("/tmp/sb-bs", { recursive: true });
  expect(depsPresent("/tmp/sb-bs")).toBe(false);
  // package directory alone is NOT enough — a source-only install (no compiled
  // .node) must read as not-ready, or entrypoints crash silently on require().
  fs.mkdirSync("/tmp/sb-bs/node_modules/better-sqlite3", { recursive: true });
  expect(depsPresent("/tmp/sb-bs")).toBe(false);
  // with the compiled native binding present → ready
  fs.mkdirSync("/tmp/sb-bs/node_modules/better-sqlite3/build/Release", { recursive: true });
  fs.writeFileSync("/tmp/sb-bs/node_modules/better-sqlite3/build/Release/better_sqlite3.node", "");
  expect(depsPresent("/tmp/sb-bs")).toBe(true);
});

it("bootstrapDone reflects the per-install marker", () => {
  fs.mkdirSync("/tmp/sb-bs", { recursive: true });
  expect(bootstrapDone("/tmp/sb-bs")).toBe(false);
  markBootstrapDone("/tmp/sb-bs");
  expect(bootstrapDone("/tmp/sb-bs")).toBe(true);
  // A different install dir must have its own independent sentinel — that's
  // the whole point of moving bootstrap-done per-install.
  fs.mkdirSync("/tmp/sb-bs-other", { recursive: true });
  expect(bootstrapDone("/tmp/sb-bs-other")).toBe(false);
});

it("sb-bootstrap is idempotent only when BOTH sentinel exists AND deps present", () => {
  fs.mkdirSync("/tmp/sb-bs", { recursive: true });
  markBootstrapDone("/tmp/sb-bs");
  // Without the native binding, sentinel alone is not enough — bootstrap must
  // still run to rebuild. Stage a fake binding so the conjoined check passes.
  fs.mkdirSync("/tmp/sb-bs/node_modules/better-sqlite3/build/Release", { recursive: true });
  fs.writeFileSync("/tmp/sb-bs/node_modules/better-sqlite3/build/Release/better_sqlite3.node", "");
  const out = execFileSync("npx", ["tsx", "bin/sb-bootstrap.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-bs-data",
      SUPERBRAIN_PLUGIN_ROOT: "/tmp/sb-bs", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/already done/);
});

it("sb-bootstrap (fake) writes per-install bootstrap-done on success", () => {
  fs.mkdirSync("/tmp/sb-bs", { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-bootstrap.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-bs-data",
      SUPERBRAIN_PLUGIN_ROOT: "/tmp/sb-bs", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(bootstrapDone("/tmp/sb-bs")).toBe(true);
});

it("sb-bootstrap re-runs when sentinel exists but native binding is missing (upgrade self-heal)", () => {
  // Simulates the Node 25 / 0.3.0 trap: stale sentinel from a previous install
  // survives into a new plugin version dir that has no .node binary yet.
  // Old code would short-circuit on sentinel and leave deps broken forever.
  // New code re-runs because the conjoined check fails.
  fs.mkdirSync("/tmp/sb-bs", { recursive: true });
  markBootstrapDone("/tmp/sb-bs");
  // No better-sqlite3 native binding staged — depsPresent is false.
  const out = execFileSync("npx", ["tsx", "bin/sb-bootstrap.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-bs-data",
      SUPERBRAIN_PLUGIN_ROOT: "/tmp/sb-bs", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(out).not.toMatch(/already done/);
});
