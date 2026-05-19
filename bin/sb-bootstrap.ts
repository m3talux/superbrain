#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { acquireLock, releaseLock } from "../src/lockfile.js";
import { bootstrapDone, markBootstrapDone } from "../src/bootstrap.js";
import { writeFailure } from "../src/sentinel.js";

function main() {
  if (bootstrapDone()) { console.log("bootstrap already done"); process.exit(0); }
  if (!acquireLock("bootstrap", { maxAgeMs: 20 * 60 * 1000 })) { process.exit(0); }
  try {
    const root = process.env.SUPERBRAIN_PLUGIN_ROOT || process.cwd();
    if (process.env.SUPERBRAIN_BOOTSTRAP_FAKE === "1") {
      markBootstrapDone();
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
      markBootstrapDone();
    }
  } catch (e: any) {
    writeFailure(`bootstrap failed (npm ci / better-sqlite3 native build): ${e?.message || e}`);
  } finally {
    releaseLock("bootstrap");
  }
  process.exit(0);
}
if ((process.argv[1] && process.argv[1].endsWith("sb-bootstrap.ts")) || process.argv[1]?.endsWith("sb-bootstrap.js")) main();
