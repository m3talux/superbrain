import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-nodeps-empty-"));
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

it("sb-recall exits 0 (no crash) when deps are absent", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-recall.ts"], {
    input: JSON.stringify({ prompt: "anything" }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: TMP },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  expect(out).toBe(""); // no additionalContext, no throw
});
