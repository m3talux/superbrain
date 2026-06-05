#!/usr/bin/env node
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";
async function main() {
    if (!depsPresent(pluginRoot())) {
        // No stdio MCP handshake possible without the SDK; exit cleanly so Claude Code
        // simply sees no server. A one-time notice is surfaced by SessionStart instead.
        process.stdout.write("SuperBrain search not ready (first-time setup in progress).\n");
        process.exit(0);
    }
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { z } = await import("zod");
    const { handleSearch } = await import("../src/mcpSearch.js");
    const server = new McpServer({ name: "superbrain", version: "0.8.1" });
    server.tool("superbrain_search", "Search the user's SuperBrain Obsidian vault (past decisions, projects, people, gotchas).", { query: z.string(), k: z.number().optional() }, async ({ query, k }) => (await handleSearch({ query, k })));
    const transport = new StdioServerTransport();
    server.connect(transport).catch(() => process.exit(1));
}
main();
