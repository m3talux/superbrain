#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFailure } from "../src/sentinel.js";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";
function resolveVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
        return pkg.version;
    }
    catch {
        return "unknown";
    }
}
async function main() {
    if (!depsPresent(pluginRoot())) {
        process.exit(0);
    }
    const version = process.env.npm_package_version || resolveVersion();
    const { reconcile, forcedReindexIfNeeded } = await import("../src/indexer.js");
    await forcedReindexIfNeeded(version).catch((e) => writeFailure(`forced reindex failed: ${e?.message || e}`));
    await reconcile().catch((e) => writeFailure(`reconcile failed: ${e?.message || e}`));
    process.exit(0);
}
main();
