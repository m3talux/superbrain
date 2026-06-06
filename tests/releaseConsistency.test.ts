import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) as Record<string, unknown>;
}

function mcpServerVersion(): string {
  const src = fs.readFileSync(path.join(root, "bin", "sb-mcp.ts"), "utf8");
  const m = src.match(/new McpServer\s*\(\s*\{\s*name\s*:\s*["'][^"']+["']\s*,\s*version\s*:\s*["']([^"']+)["']/);
  if (!m) throw new Error("McpServer version not found in bin/sb-mcp.ts");
  return m[1];
}

describe("release consistency", () => {
  it("all five version sources agree", () => {
    const pkg = readJson("package.json");
    const lockfile = readJson("package-lock.json");
    const pluginJson = readJson(".claude-plugin/plugin.json");
    const marketplaceJson = readJson(".claude-plugin/marketplace.json");
    const mcpVersion = mcpServerVersion();

    const packageVersion = pkg.version as string;
    const lockfileVersion = lockfile.version as string;
    const pluginVersion = pluginJson.version as string;
    const marketplaceVersion = (
      (marketplaceJson.plugins as Array<Record<string, unknown>>)[0]
    ).version as string;

    expect(lockfileVersion, "package-lock.json version must match package.json").toBe(packageVersion);
    expect(pluginVersion, ".claude-plugin/plugin.json version must match package.json").toBe(packageVersion);
    expect(marketplaceVersion, ".claude-plugin/marketplace.json plugin version must match package.json").toBe(packageVersion);
    expect(mcpVersion, "bin/sb-mcp.ts McpServer version must match package.json").toBe(packageVersion);
  });
});
