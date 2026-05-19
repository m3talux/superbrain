import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { depsPresent, bootstrapDone, markBootstrapDone } from "../src/bootstrap";

beforeEach(() => {
  fs.rmSync("/tmp/sb-bs", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-bs-data", { recursive: true, force: true });
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-bs-data";
});

it("depsPresent is false without node_modules/better-sqlite3, true with it", () => {
  fs.mkdirSync("/tmp/sb-bs", { recursive: true });
  expect(depsPresent("/tmp/sb-bs")).toBe(false);
  fs.mkdirSync("/tmp/sb-bs/node_modules/better-sqlite3", { recursive: true });
  expect(depsPresent("/tmp/sb-bs")).toBe(true);
});

it("bootstrapDone reflects the marker", () => {
  expect(bootstrapDone()).toBe(false);
  markBootstrapDone();
  expect(bootstrapDone()).toBe(true);
});

it("sb-bootstrap is idempotent: no-op when bootstrap-done exists", () => {
  markBootstrapDone();
  const out = execFileSync("npx", ["tsx", "bin/sb-bootstrap.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-bs-data",
      SUPERBRAIN_PLUGIN_ROOT: "/tmp/sb-bs", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/already done/);
});

it("sb-bootstrap (fake) writes bootstrap-done on success", () => {
  fs.mkdirSync("/tmp/sb-bs", { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-bootstrap.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-bs-data",
      SUPERBRAIN_PLUGIN_ROOT: "/tmp/sb-bs", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(bootstrapDone()).toBe(true);
});
