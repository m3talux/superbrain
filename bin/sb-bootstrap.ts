#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { acquireLock, releaseLock } from "../src/lockfile.js";
import { bootstrapDone, markBootstrapDone, depsPresent } from "../src/bootstrap.js";
import { writeFailure } from "../src/sentinel.js";

function main() {
  const root = process.env.SUPERBRAIN_PLUGIN_ROOT || process.cwd();
  // Conjoined check: skip only when BOTH the per-install sentinel exists AND
  // the better-sqlite3 native binding is actually present in this install.
  // Without the depsPresent half, a stale sentinel from an earlier plugin
  // version (or a Node ABI change) traps the new install in a permanent
  // "bootstrap pending" state — bootstrap fires, sees sentinel, exits,
  // depsPresent stays false forever. See PR for the Node 25 / 0.3.0 trap.
  if (bootstrapDone(root) && depsPresent(root)) { console.log("bootstrap already done"); process.exit(0); }
  if (!acquireLock("bootstrap", { maxAgeMs: 20 * 60 * 1000 })) { process.exit(0); }
  try {
    if (process.env.SUPERBRAIN_BOOTSTRAP_FAKE === "1") {
      markBootstrapDone(root);
    } else {
      execFileSync("npm", ["ci", "--omit=dev"], { cwd: root, stdio: "ignore" });
      // `npm ci` does NOT guarantee better-sqlite3's native addon: on a Node
      // ABI with no published prebuild it leaves the package source-only.
      // Force a source rebuild, then verify the binding actually loads under
      // this Node runtime. Only mark done if it genuinely works — otherwise
      // the sentinel fires and SessionStart retries next session.
      execFileSync("npm", ["rebuild", "better-sqlite3"], { cwd: root, stdio: "ignore" });
      execFileSync(
        process.execPath,
        ["-e", "require(require('node:path').join(process.cwd(),'node_modules','better-sqlite3'))"],
        { cwd: root, stdio: "ignore" },
      );
      markBootstrapDone(root);
    }
  } catch (e: any) {
    writeFailure(`bootstrap failed (npm ci / better-sqlite3 native build): ${e?.message || e}`);
  } finally {
    releaseLock("bootstrap");
  }
  process.exit(0);
}
if ((process.argv[1] && process.argv[1].endsWith("sb-bootstrap.ts")) || process.argv[1]?.endsWith("sb-bootstrap.js")) main();
