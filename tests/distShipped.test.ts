import { it, expect } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

it(".gitignore no longer ignores dist/", () => {
  const gi = fs.readFileSync(".gitignore", "utf8").split(/\r?\n/);
  expect(gi).not.toContain("dist/");
  expect(gi).toContain("node_modules/");
});

it("key compiled entrypoints are tracked in git", () => {
  const tracked = execFileSync("git", ["ls-files", "dist"], { encoding: "utf8" });
  for (const f of ["dist/bin/sb-session-start.js", "dist/bin/sb-distill.js", "dist/bin/sb-bootstrap.js", "dist/bin/sb.js", "dist/src/paths.js"])
    expect(tracked).toContain(f);
});

it("package.json has a release:check script", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  expect(pkg.scripts["release:check"]).toMatch(/build.*git diff --exit-code dist/);
});
