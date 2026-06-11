#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFailure } from "../src/sentinel.js";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";
import { acquireLock, releaseLock } from "../src/lockfile.js";
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
    // Singleton: every SessionStart spawns this daemon; concurrent copies
    // multiply RAM and re-sweep the same orphans. Second copy yields silently.
    if (!acquireLock("reconcile", { maxAgeMs: 30 * 60 * 1000 })) {
        process.exit(0);
    }
    try {
        const version = process.env.npm_package_version || resolveVersion();
        const { reconcile, forcedReindexIfNeeded } = await import("../src/indexer.js");
        await forcedReindexIfNeeded(version).catch((e) => writeFailure(`forced reindex failed: ${e?.message || e}`));
        const { runCheapUpgradeSteps } = await import("../src/autoUpgrade.js");
        const { dataDir } = await import("../src/paths.js");
        await runCheapUpgradeSteps(dataDir(), version).catch((e) => writeFailure(`auto-upgrade failed: ${e?.message || e}`));
        await reconcile().catch((e) => writeFailure(`reconcile failed: ${e?.message || e}`));
        try {
            const { sweepOrphanedSessions } = await import("../src/distillRun.js");
            await sweepOrphanedSessions(process.env.SUPERBRAIN_SESSION_ID || "");
        }
        catch (e) {
            writeFailure(`orphan sweep failed: ${e?.message || e}`);
        }
        try {
            const { runSessionGcOncePerDay } = await import("../src/sessionGcRun.js");
            runSessionGcOncePerDay(dataDir());
        }
        catch (e) {
            writeFailure(`session gc failed: ${e?.message || e}`);
        }
    }
    finally {
        releaseLock("reconcile");
    }
    process.exit(0);
}
main();
