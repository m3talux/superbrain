#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFailure } from "../src/sentinel.js";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";

function resolveVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"
    ));
    return pkg.version as string;
  } catch { return "unknown"; }
}

async function main() {
  if (!depsPresent(pluginRoot())) {
    process.exit(0);
  }
  const version = process.env.npm_package_version || resolveVersion();
  const { reconcile, forcedReindexIfNeeded } = await import("../src/indexer.js");
  await forcedReindexIfNeeded(version).catch(
    (e: any) => writeFailure(`forced reindex failed: ${e?.message || e}`)
  );
  const { runCheapUpgradeSteps } = await import("../src/autoUpgrade.js");
  const { dataDir } = await import("../src/paths.js");
  await runCheapUpgradeSteps(dataDir(), version).catch(
    (e: any) => writeFailure(`auto-upgrade failed: ${e?.message || e}`)
  );
  await reconcile().catch((e: any) => writeFailure(`reconcile failed: ${e?.message || e}`));
  try {
    const { runSessionGcOncePerDay } = await import("../src/sessionGcRun.js");
    runSessionGcOncePerDay(dataDir());
  } catch (e: any) {
    writeFailure(`session gc failed: ${e?.message || e}`);
  }
  process.exit(0);
}

main();
