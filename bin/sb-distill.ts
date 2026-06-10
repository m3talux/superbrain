#!/usr/bin/env node
import { releaseLock } from "../src/lockfile.js";
import { writeFailure } from "../src/sentinel.js";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";

// sb-distill.js is only ever spawned as the distill child (its own dedicated
// script), so it has no isChild() guard — matching the pre-P4 behavior.
async function main() {
  if (!depsPresent(pluginRoot())) {
    try { writeFailure("distill skipped: dependencies not yet installed (bootstrap pending)"); } catch { /* noop */ }
    try { releaseLock("distill", process.env.SUPERBRAIN_LOCK_TOKEN); } catch { /* noop */ }
    process.exit(0);
  }
  try {
    const run = await import("../src/distillRun.js");
    await run.runDistill();
  } catch (e: any) {
    try { writeFailure(`distill failed: ${e?.message || e}`); } catch { /* noop */ }
    try { releaseLock("distill", process.env.SUPERBRAIN_LOCK_TOKEN); } catch { /* noop */ }
  }
  process.exit(0);
}
if ((process.argv[1] && process.argv[1].endsWith("sb-distill.ts")) || process.argv[1]?.endsWith("sb-distill.js")) main();
