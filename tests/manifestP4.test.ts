import { it, expect } from "vitest";
import fs from "node:fs";

it("plugin.json version is in lockstep and does NOT redeclare auto-discovered paths", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const plg = JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8"));
  expect(plg.version).toBe(pkg.version);
  // Claude Code auto-discovers hooks/hooks.json, commands/, skills/ and .mcp.json
  // by convention. Declaring them in plugin.json double-loads them — the hooks
  // one is a fatal "Duplicate hooks file detected" at install. They must be absent.
  for (const k of ["hooks", "commands", "skills", "mcpServers"]) {
    expect(plg[k], `plugin.json must not declare "${k}" (auto-discovered by Claude Code)`).toBeUndefined();
  }
});

it("plugin.json author is an object with a name (Claude Code schema requires object, not string)", () => {
  const plg = JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8"));
  expect(typeof plg.author).toBe("object");
  expect(plg.author).not.toBeNull();
  expect(Array.isArray(plg.author)).toBe(false);
  expect(typeof plg.author.name).toBe("string");
  expect(plg.author.name.length).toBeGreaterThan(0);
});

it("slash-command files invoke the sb.js CLI", () => {
  const adopt = fs.readFileSync("commands/adopt.md", "utf8");
  const migrate = fs.readFileSync("commands/migrate.md", "utf8");
  expect(adopt).toMatch(/sb\.js" adopt/);
  expect(migrate).toMatch(/sb\.js" migrate/);
});
