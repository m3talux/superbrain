#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readAndClearFailure } from "../src/sentinel.js";
import { needsRollup, markRollup } from "../src/rollupState.js";
import { dataDir, vaultPath } from "../src/paths.js";
import { isChild } from "../src/distillerEngine.js";

function yesterday(): string {
  const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
}
function sourceHash(): string {
  try {
    const p = path.join(vaultPath(), "log.md");
    return String(fs.statSync(p).size);
  } catch { return "0"; }
}

async function main() {
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
      } else {
        try {
          const { spawn } = await import("node:child_process");
          const c = spawn("claude", ["-p", `Run superbrain-distill in rollup mode for daily ${key}.`],
            { detached: true, stdio: "ignore", env: { ...process.env, SUPERBRAIN_CHILD: "1" }, cwd: vaultPath() });
          c.unref();
        } catch { /* non-fatal */ }
      }
      markRollup("daily", key, h);
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
