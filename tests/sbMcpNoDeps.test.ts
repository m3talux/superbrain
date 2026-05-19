import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => { fs.mkdirSync("/tmp/sb-mcp-empty", { recursive: true }); });

it("sb-mcp exits 0 cleanly when deps absent (no MCP, no crash)", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-mcp.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: "/tmp/sb-mcp-empty" },
    encoding: "utf8", timeout: 10000,
  });
  expect(out).toMatch(/SuperBrain search not ready/);
});
