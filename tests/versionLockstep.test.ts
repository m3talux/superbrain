import { it, expect } from "vitest";
import fs from "node:fs";

it("the MCP server version tracks package.json", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  const mcp = fs.readFileSync("bin/sb-mcp.ts", "utf8").match(/version: "([^"]+)"/)?.[1];
  expect(mcp).toBe(pkg);
});
