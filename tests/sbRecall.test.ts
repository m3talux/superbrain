import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-rh";
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.rmSync("/tmp/sb-rh", { recursive: true, force: true });
  const ix = openIndex();
  ix.upsertNote("projects/super-brain.md", 1, "h",
    [{ headingPath: "Decisions", anchor: "decisions", text: "we picked RRF hybrid fusion for recall" }],
    [Float32Array.from(Array(384).fill(0.4))]);
  ix.close();
});

function run(hook: object, extraEnv: Record<string, string> = {}) {
  return execFileSync("npx", ["tsx", "bin/sb-recall.ts"], {
    input: JSON.stringify(hook),
    env: { ...process.env, ...extraEnv }, encoding: "utf8",
  });
}

describe("sb-recall", () => {
  it("injects additionalContext pointers for a relevant prompt", () => {
    const out = run({ session_id: "S", hook_event_name: "UserPromptSubmit", cwd: "/p",
                       prompt: "how did we do recall fusion?" });
    expect(out).toMatch(/additionalContext/);
    expect(out).toMatch(/super-brain/);
  });
  it("emits nothing for an empty prompt and exits 0", () => {
    const out = run({ session_id: "S", hook_event_name: "UserPromptSubmit", cwd: "/p", prompt: "" });
    expect(out.trim()).toBe("");
  });
  it("recursion guard makes it a silent no-op", () => {
    const out = run({ session_id: "S", hook_event_name: "UserPromptSubmit", cwd: "/p", prompt: "recall" },
                     { SUPERBRAIN_CHILD: "1" });
    expect(out.trim()).toBe("");
  });
});
