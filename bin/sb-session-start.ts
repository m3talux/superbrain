#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readAndClearFailure } from "../src/sentinel.js";
import { needsRollup, markRollup } from "../src/rollupState.js";
import { dataDir, vaultPath } from "../src/paths.js";
import { isChild, buildDistillCommand } from "../src/distillerEngine.js";

function yesterday(): string {
  const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
}
function sourceHash(): string {
  try {
    const p = path.join(vaultPath(), "log.md");
    return String(fs.statSync(p).size);
  } catch { return "0"; }
}

function main() {
  if (isChild()) process.exit(0);
  try {
    const fail = readAndClearFailure();
    const parts: string[] = [];
    if (fail) parts.push(`⚠️ SuperBrain: last capture failed — ${fail.trim()} (fixed automatically next checkpoint; set ANTHROPIC_API_KEY if it persists).`);

    // Idempotent daily catch-up (capped to yesterday only for Phase 1).
    const key = yesterday();
    const h = sourceHash();
    if (needsRollup("daily", key, h)) {
      if (process.env.SUPERBRAIN_FAKE_DISTILLER === "1") {
        fs.mkdirSync(dataDir(), { recursive: true });
        fs.writeFileSync(path.join(dataDir(), "rollup-invoked"), key);
        markRollup("daily", key, h);
      } else {
        try {
          // Spawn the real writer detached; it calls markRollup on success (conditional).
          const spec = buildDistillCommand({ sessionId: `rollup-${key}`, cwd: vaultPath(), rollup: `daily:${key}:${h}` });
          const c = spawn(spec.cmd, spec.args, spec.options);
          c.unref();
        } catch { /* non-fatal */ }
        // Do NOT call markRollup here — the spawned child marks it on success.
        // This preserves self-heal: if the child fails, needsRollup will be true next time.
      }
      parts.push(`SuperBrain: generating daily rollup for ${key}.`);
    }

    if (parts.length) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: parts.join("\n") },
      }));
    }
  } catch { /* a SessionStart hook must never crash the session */ }
  process.exit(0);
}
main();
