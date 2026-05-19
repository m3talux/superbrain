#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readAndClearFailure } from "../src/sentinel.js";
import { needsRollup, markRollup } from "../src/rollupState.js";
import { dataDir, vaultPath } from "../src/paths.js";
import { isChild, buildDistillCommand } from "../src/distillerEngine.js";
import { hybridRecall } from "../src/recall.js";

// Stable per-day gate value. The rollup's own writes cannot change this string,
// so needsRollup returns false for an already-processed key → converges.
const ROLLUP_HASH = "v1";

function yesterday(): string {
  const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
}

function readStdin(): string { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }

async function main() {
  if (isChild()) process.exit(0);
  try {
    let h: any = {}; try { h = JSON.parse(readStdin()) || {}; } catch { h = {}; }
    const fail = readAndClearFailure();
    const parts: string[] = [];
    if (fail) parts.push(`⚠️ SuperBrain: last capture failed — ${fail.trim()} (fixed automatically next checkpoint; set ANTHROPIC_API_KEY if it persists).`);

    // Idempotent daily catch-up (capped to yesterday only for Phase 1).
    const key = yesterday();
    if (needsRollup("daily", key, ROLLUP_HASH)) {
      if (process.env.SUPERBRAIN_FAKE_DISTILLER === "1") {
        fs.mkdirSync(dataDir(), { recursive: true });
        fs.writeFileSync(path.join(dataDir(), "rollup-invoked"), key);
        markRollup("daily", key, ROLLUP_HASH);
      } else {
        try {
          // Ensure the vault directory exists so spawn's cwd is valid.
          fs.mkdirSync(vaultPath(), { recursive: true });
          // Spawn the real writer detached; it calls markRollup on success (conditional).
          const spec = buildDistillCommand({ sessionId: `rollup-${key}`, cwd: vaultPath(), rollup: `daily:${key}:${ROLLUP_HASH}` });
          const c = spawn(spec.cmd, spec.args, spec.options);
          c.unref();
        } catch { /* non-fatal */ }
        // Do NOT call markRollup here — the spawned child marks it on success.
        // This preserves self-heal: if the child fails, needsRollup will be true next time.
      }
      parts.push(`SuperBrain: generating daily rollup for ${key}.`);
    }

    // Hybrid recall digest (cwd/recent-topic seeded). Tiered: pointers, not bodies.
    try {
      const seed = `${path.basename(h.cwd || "")} recent work decisions gotchas`.trim();
      const hits = await hybridRecall(seed, 5);
      if (hits.length) {
        parts.push("SuperBrain memory — relevant past notes:\n" +
          hits.map((p) => `- [[${p.relPath.replace(/\.md$/, "")}]] — ${p.excerpt}`).join("\n"));
      }
    } catch { /* recall is best-effort */ }

    // Detached, recursion-guarded index reconcile so Obsidian/git drift self-heals
    // without blocking startup. Uses the same node-spawn pattern as the distiller.
    if (process.env.SUPERBRAIN_FAKE_DISTILLER !== "1") {
      try {
        const reconciler = fileURLToPath(new URL("./sb-reconcile.js", import.meta.url));
        spawn(process.execPath, [reconciler], {
          detached: true, stdio: "ignore",
          env: { ...process.env, SUPERBRAIN_CHILD: "1" }, cwd: vaultPath(),
        }).unref();
      } catch { /* non-fatal */ }
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
