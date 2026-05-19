#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { handleSearch } from "../src/mcpSearch.js";

const server = new McpServer({ name: "superbrain", version: "0.2.0" });

server.tool(
  "superbrain_search",
  "Search the user's SuperBrain Obsidian vault (past decisions, projects, people, gotchas).",
  { query: z.string(), k: z.number().optional() },
  async ({ query, k }) => handleSearch({ query, k }) as Promise<CallToolResult>,
);

const transport = new StdioServerTransport();
server.connect(transport).catch(() => process.exit(1));
