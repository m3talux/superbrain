import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-mcp-empty-"));
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

it("sb-mcp exits 0 cleanly when deps absent (no MCP, no crash)", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-mcp.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: TMP },
    encoding: "utf8", timeout: 10000,
  });
  expect(out).toMatch(/SuperBrain search not ready/);
});
