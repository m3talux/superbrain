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

it("src/claudeCli.ts is the single claude call site and includes the --model pin", () => {
  const src = fs.readFileSync("src/claudeCli.ts", "utf8");
  // claudeCli.ts is the sole execFileSync("claude") call site after the
  // cross-platform refactor. The model pin is built into the args array
  // alongside distillModel(), so verify both are present together.
  expect(src).toMatch(/execFileSync\("claude"/);
  expect(src).toMatch(/distillModel\(\)/);
  expect(src).toMatch(/--model/);
  // No other source file may bypass the wrapper with a direct execFileSync("claude").
  for (const f of ["src/distillRun.ts", "src/injectRun.ts", "src/discoverer.ts"]) {
    const s = fs.readFileSync(f, "utf8");
    expect(s, `${f} must not contain a direct execFileSync("claude")`).not.toMatch(/execFileSync\("claude"/);
  }
});
