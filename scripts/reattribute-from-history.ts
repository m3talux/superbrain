#!/usr/bin/env -S node --experimental-strip-types
// scripts/reattribute-from-history.ts
//
// Migration: re-derive the project field on vault notes whose project frontmatter
// is missing or junk, using cwd recorded in the session ndjson files that wrote
// those notes.
//
// Usage:
//   npx tsx scripts/reattribute-from-history.ts [--data-dir <path>]          # dry-run
//   npx tsx scripts/reattribute-from-history.ts [--data-dir <path>] --apply  # write

import fs from "node:fs";
import path from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  const dataDirIdx = args.indexOf("--data-dir");
  let resolvedDataDir: string;
  if (dataDirIdx >= 0 && args[dataDirIdx + 1]) {
    resolvedDataDir = args[dataDirIdx + 1];
  } else {
    const { dataDir } = await import("../src/paths.js");
    resolvedDataDir = dataDir();
  }

  if (!fs.existsSync(resolvedDataDir)) {
    console.log(`Data dir not found: ${resolvedDataDir}. Nothing to do.`);
    return;
  }

  const { planReattribution, applyReattribution } = await import("../src/reattributeFromHistory.js");
  const plan = planReattribution(resolvedDataDir);

  if (plan.fixes.length === 0) {
    console.log("No notes with missing or junk project found. Nothing to do.");
    return;
  }

  if (!apply) {
    console.log(`Dry-run: would re-attribute ${plan.fixes.length} note(s)`);
    for (const fix of plan.fixes) {
      const was = fix.oldProject === undefined ? "(missing)" : `"${fix.oldProject}"`;
      console.log(`  ${fix.relPath}: ${was} → "${fix.newProject}"`);
    }
    console.log("\n(Dry-run. Use --apply to write changes.)");
  } else {
    applyReattribution(plan);
    console.log(`Re-attributed ${plan.fixes.length} note(s).`);
    for (const fix of plan.fixes) {
      const was = fix.oldProject === undefined ? "(missing)" : `"${fix.oldProject}"`;
      console.log(`  ${fix.relPath}: ${was} → "${fix.newProject}"`);
    }
  }
}

if (
  process.argv[1]?.endsWith("reattribute-from-history.ts") ||
  process.argv[1]?.endsWith("reattribute-from-history.js")
) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
