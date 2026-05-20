import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex";

beforeEach(() => {
  process.env.SUPERBRAIN_DATA_DIR = "/tmp/sb-mcp";
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.rmSync("/tmp/sb-mcp", { recursive: true, force: true });
  const ix = openIndex();
  ix.upsertNote("projects/p.md", 1, "h",
    [{ headingPath: "", anchor: "", text: "the daily rollup converges with a stable v1 gate" }],
    [Float32Array.from(Array(384).fill(0.7))]);
  ix.close();
});

it("responds to initialize, tools/list, and tools/call over stdio", () => {
  const msgs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "superbrain_search", arguments: { query: "rollup converges", k: 3 } } },
  ].map((m) => JSON.stringify(m)).join("\n") + "\n";
  const out = execFileSync("npx", ["tsx", "bin/sb-mcp.ts"], { input: msgs, encoding: "utf8", timeout: 30000 });
  expect(out).toMatch(/"superbrain_search"/);     // tools/list
  expect(out).toMatch(/projects\/p/);             // tools/call result
});
