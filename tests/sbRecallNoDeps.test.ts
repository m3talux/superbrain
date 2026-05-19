import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => { fs.mkdirSync("/tmp/sb-nodeps-empty", { recursive: true }); });

it("sb-recall exits 0 (no crash) when deps are absent", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-recall.ts"], {
    input: JSON.stringify({ prompt: "anything" }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: "/tmp/sb-nodeps-empty" },
    encoding: "utf8",
  });
  expect(out).toBe(""); // no additionalContext, no throw
});
