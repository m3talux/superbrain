import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { migrateLegacy } from "../bin/sb";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-mig-data";
  fs.rmSync("/tmp/sb-mig-data", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-fake-home", { recursive: true, force: true });
  fs.mkdirSync("/tmp/sb-fake-home/.claude/hooks", { recursive: true });
  fs.writeFileSync("/tmp/sb-fake-home/.claude/hooks/stop-scribe.sh", "#legacy");
});

it("archives legacy scribe idempotently and never deletes", () => {
  const r1 = migrateLegacy("/tmp/sb-fake-home");
  expect(r1.archived).toContain("stop-scribe.sh");
  expect(fs.existsSync("/tmp/sb-mig-data/archived-legacy/stop-scribe.sh")).toBe(true);
  expect(fs.existsSync("/tmp/sb-fake-home/.claude/hooks/stop-scribe.sh")).toBe(false);
  const r2 = migrateLegacy("/tmp/sb-fake-home"); // idempotent: nothing left to do
  expect(r2.archived).toEqual([]);
});
