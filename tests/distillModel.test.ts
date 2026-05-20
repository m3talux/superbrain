import { it, expect } from "vitest";
import fs from "node:fs";
import { distillModel } from "../src/distillRun.js";

// Cost-control invariant: the detached distill/rollup `claude -p` spawns must
// NEVER inherit the user's session model (often Opus, which burned the legacy
// scribe's daily quota in hours). The model is hardcoded — no env override —
// so users never have to think about model selection.

it("distillModel is hardcoded to claude-sonnet-4-6 (no env override)", () => {
  // Even if a user sets SUPERBRAIN_MODEL the function ignores it: the model is
  // a code-level decision, not a user-facing knob.
  const prev = process.env.SUPERBRAIN_MODEL;
  try {
    process.env.SUPERBRAIN_MODEL = "claude-opus-4-7";
    expect(distillModel()).toBe("claude-sonnet-4-6");
  } finally {
    if (prev === undefined) delete process.env.SUPERBRAIN_MODEL;
    else process.env.SUPERBRAIN_MODEL = prev;
  }
});

it("every `claude -p` invocation in src/distillRun.ts passes --model", () => {
  const src = fs.readFileSync("src/distillRun.ts", "utf8");
  // All claude-CLI invocations in the distill path must include the --model
  // pin. Both the direct `execFileSync("claude", ...)` and our helper.
  const calls = src.match(/execFileSync\("claude"[\s\S]*?\)/g) || [];
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    expect(c, "missing --model pin: " + c).toMatch(/--model/);
  }
});
