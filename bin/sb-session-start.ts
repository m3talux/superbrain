#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAndClearFailure } from "../src/sentinel.js";
import { dataDir, vaultPath, pluginRoot } from "../src/paths.js";
import { isChild } from "../src/distillerEngine.js";
import { depsPresent, runBootstrap } from "../src/bootstrap.js";
import { recordedVaultPath } from "../src/vaultMarker.js";
import { isUnknownProject, looksLikeCodeProject } from "../src/discoverer.js";
import { spawnDetachedChild } from "../src/spawnChild.js";

function readStdin(): string { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }

async function main() {
  if (isChild()) process.exit(0);
  try {
    let h: any = {}; try { h = JSON.parse(readStdin()) || {}; } catch { h = {}; }
    const fail = readAndClearFailure();
    const parts: string[] = [];
    if (fail) {
      // The ANTHROPIC_API_KEY escape hatch only helps when the distiller's
      // claude -p spawn failed (auth/quota). Appending it to every failure —
      // index errors included — misled the 2026-06 incident diagnosis toward
      // auth/quota, so scope it to distill failures.
      const apiKeyHint = /distill/i.test(fail) ? "; set ANTHROPIC_API_KEY if it persists" : "";
      parts.push(`⚠️ SuperBrain: last capture failed — ${fail.trim()} (fixed automatically next checkpoint${apiKeyHint}).`);
    }

    const root = pluginRoot();
    if (!depsPresent(root)) {
      runBootstrap(root);
      parts.push("SuperBrain is finishing one-time setup for this version (building native dependencies and fetching the embedding model). Recall, the session brief, and capture are warming up and will be ready next session; for now, work from the current conversation rather than assuming SuperBrain recall is available.");
    } else {
      // One-time backfill: assign project to all NULL notes before any query.
      // Ships atomically with the fail-closed isCrossProject filter.
      try {
        const { runBackfillIfNeeded } = await import("../src/indexer.js");
        await runBackfillIfNeeded();
      } catch { /* best-effort; never block startup */ }
      const { appendDigest } = await import("../src/sessionDigest.js"); // deferred heavy import
      await appendDigest(parts, h);
    }
    // One-time courtesy notice when using the owned default vault (no adopted vault).
    try {
      if (!recordedVaultPath()) {
        const flag = path.join(dataDir(), "owned-vault-notice");
        if (!fs.existsSync(flag)) {
          parts.push("SuperBrain is capturing into ~/.superbrain/vault. To pull an existing Obsidian vault into that location, run `/superbrain:migrate` (preferred). To point SuperBrain at an already-established Obsidian vault instead, run `/superbrain:adopt <path>`.");
          fs.mkdirSync(path.dirname(flag), { recursive: true }); fs.writeFileSync(flag, "1");
        }
      }
    } catch { /* courtesy notice is best-effort */ }

    // Detached, recursion-guarded index reconcile so Obsidian/git drift self-heals
    // without blocking startup. Uses the same node-spawn pattern as the distiller.
    // Debounced: SessionStart also fires for every claude -p one-shot, and a
    // burst of those must not stack daemons (sb-reconcile itself also holds a
    // singleton lock as the second line of defence).
    if (process.env.SUPERBRAIN_FAKE_DISTILLER !== "1" && depsPresent(root)) {
      try {
        const { shouldSpawnReconcile } = await import("../src/reconcileGate.js");
        if (shouldSpawnReconcile(dataDir())) {
          const reconciler = fileURLToPath(new URL("./sb-reconcile.js", import.meta.url));
          spawnDetachedChild("reconcile", reconciler, {
            ...process.env, SUPERBRAIN_CHILD: "1", SUPERBRAIN_SESSION_ID: String(h.session_id || ""),
          }, { cwd: vaultPath() });
        }
      } catch { /* non-fatal */ }
    }

    // First-time project discovery: if this session opened in a project we
    // have no note for yet, spawn a one-shot detached discoverer. Runs at
    // most once per project (the existence of the project note is the gate)
    // and never blocks the session. Failures land in the sentinel.
    if (process.env.SUPERBRAIN_FAKE_DISTILLER !== "1" && depsPresent(root)) {
      try {
        const projectDir = h.cwd || process.env.CLAUDE_PROJECT_DIR;
        if (projectDir && looksLikeCodeProject(projectDir) && isUnknownProject(projectDir)) {
          const discoverer = fileURLToPath(new URL("./sb-discover.js", import.meta.url));
          spawnDetachedChild("discover", discoverer, {
            ...process.env, SUPERBRAIN_CHILD: "1", SUPERBRAIN_PROJECT_DIR: projectDir,
          });
          parts.push(`SuperBrain is mapping this project for the first time — a project note will appear in the vault shortly.`);
        }
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
