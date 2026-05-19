import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
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
