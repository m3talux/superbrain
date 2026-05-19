import { it, expect } from "vitest";
import fs from "node:fs";

it("plugin.json version matches package.json and references commands", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const plg = JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8"));
  expect(plg.version).toBe(pkg.version);
  expect(plg.commands).toBe("./commands");
});

it("slash-command files invoke the sb.js CLI", () => {
  const adopt = fs.readFileSync("commands/adopt.md", "utf8");
  const migrate = fs.readFileSync("commands/migrate.md", "utf8");
  expect(adopt).toMatch(/sb\.js" adopt/);
  expect(migrate).toMatch(/sb\.js" migrate/);
});
