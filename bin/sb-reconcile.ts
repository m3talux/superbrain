#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconcile, forcedReindexIfNeeded } from "../src/indexer.js";
import { writeFailure } from "../src/sentinel.js";
import { dataDir } from "../src/paths.js";

function resolveVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"
    ));
    return pkg.version as string;
  } catch { return "unknown"; }
}

async function main() {
  const version = process.env.npm_package_version || resolveVersion();
  await forcedReindexIfNeeded(version, dataDir()).catch(
    (e: any) => writeFailure(`forced reindex failed: ${e?.message || e}`)
  );
  await reconcile().catch((e: any) => writeFailure(`reconcile failed: ${e?.message || e}`));
}

main().finally(() => process.exit(0));
