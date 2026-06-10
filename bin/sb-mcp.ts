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
  const { handleChildren } = await import("../src/mcpChildren.js");
  const server = new McpServer({ name: "superbrain", version: "0.8.1" });
  server.tool(
    "superbrain_search",
    "Search the user's SuperBrain Obsidian vault (past decisions, projects, people, gotchas). Optional scope: project (slug), type (note type e.g. decision/capture/lesson), since (ISO date, only newer notes), role (agent_role).",
    {
      query: z.string(),
      k: z.number().optional(),
      project: z.string().optional(),
      type: z.string().optional(),
      since: z.string().optional(),
      role: z.string().optional(),
    },
    async ({ query, k, project, type, since, role }: { query: string; k?: number; project?: string; type?: string; since?: string; role?: string }) =>
      (await handleSearch({ query, k, project, type, since, role })) as any,
  );
  server.tool(
    "superbrain_children",
    "List the daily-state entries (open threads, projects) of the child sessions a given parent session dispatched on a date (defaults to today).",
    { parentSessionId: z.string(), date: z.string().optional() },
    async ({ parentSessionId, date }: { parentSessionId: string; date?: string }) =>
      (await handleChildren({ parentSessionId, date })) as any,
  );
  const transport = new StdioServerTransport();
  server.connect(transport).catch(() => process.exit(1));
}
main();
