import { it, expect } from "vitest";
import fs from "node:fs";

it("plugin manifest registers the recall skill + mcp; .mcp.json is valid; skill name matches dir", () => {
  const p = JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8"));
  expect(p.skills).toContain("./skills/superbrain-recall");
  expect(p.mcpServers || p.mcp).toBeTruthy();
  const m = JSON.parse(fs.readFileSync(".mcp.json", "utf8"));
  const srv = m.mcpServers.superbrain;
  expect(srv.command).toBe("node");
  expect(srv.args.join(" ")).toMatch(/sb-mcp\.js/);
  const skill = fs.readFileSync("skills/superbrain-recall/SKILL.md", "utf8");
  expect(skill).toMatch(/^name:\s*superbrain-recall/m);
});
