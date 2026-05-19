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
      markBootstrapDone();
    }
  } catch (e: any) {
    writeFailure(`bootstrap (npm ci) failed: ${e?.message || e}`);
  } finally {
    releaseLock("bootstrap");
  }
  process.exit(0);
}
if ((process.argv[1] && process.argv[1].endsWith("sb-bootstrap.ts")) || process.argv[1]?.endsWith("sb-bootstrap.js")) main();
