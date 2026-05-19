import { it, expect } from "vitest";
import fs from "node:fs";

// Claude Code's `/plugin marketplace add <repo>` requires the marketplace
// manifest at `.claude-plugin/marketplace.json` (NOT repo root). These tests
// lock in the packaging contract so the install path can't silently break.

it("marketplace.json exists at .claude-plugin/ and is valid JSON", () => {
  expect(fs.existsSync(".claude-plugin/marketplace.json")).toBe(true);
  const mk = JSON.parse(fs.readFileSync(".claude-plugin/marketplace.json", "utf8"));
  expect(typeof mk.name).toBe("string");
  expect(mk.name.length).toBeGreaterThan(0);
  expect(typeof mk.owner?.name).toBe("string");
  expect(Array.isArray(mk.plugins)).toBe(true);
  expect(mk.plugins.length).toBeGreaterThan(0);
});

it("the superbrain plugin entry points at the repo root and tracks the version", () => {
  const mk = JSON.parse(fs.readFileSync(".claude-plugin/marketplace.json", "utf8"));
  const plg = JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8"));
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const entry = mk.plugins.find((p: { name: string }) => p.name === "superbrain");
  expect(entry).toBeDefined();
  expect(entry.source).toBe("./"); // plugin manifest is at repo-root .claude-plugin/plugin.json
  expect(entry.version).toBe(plg.version);
  expect(entry.version).toBe(pkg.version);
});

it("no stale marketplace.json at the repo root (wrong location)", () => {
  expect(fs.existsSync("marketplace.json")).toBe(false);
});
