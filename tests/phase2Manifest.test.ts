import { it, expect } from "vitest";
import fs from "node:fs";

it("recall skill + mcp are packaged at conventional auto-discovered paths; .mcp.json is valid; skill name matches dir", () => {
  // Claude Code auto-discovers skills/ and .mcp.json by convention — they must
  // exist at the conventional paths and must NOT be redeclared in plugin.json
  // (declaring auto-discovered paths double-loads them).
  expect(fs.existsSync("skills/superbrain-recall/SKILL.md")).toBe(true);
  expect(fs.existsSync(".mcp.json")).toBe(true);
  const m = JSON.parse(fs.readFileSync(".mcp.json", "utf8"));
  const srv = m.mcpServers.superbrain;
  expect(srv.command).toBe("node");
  expect(srv.args.join(" ")).toMatch(/sb-mcp\.js/);
  const skill = fs.readFileSync("skills/superbrain-recall/SKILL.md", "utf8");
  expect(skill).toMatch(/^name:\s*superbrain-recall/m);
});
