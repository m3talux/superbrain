#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { acquireLock, releaseLock } from "../src/lockfile.js";
import { bootstrapDone, markBootstrapDone, depsPresent } from "../src/bootstrap.js";
import { writeFailure } from "../src/sentinel.js";
import { dataDir, vaultPath } from "../src/paths.js";
const PLATFORM_HINTS = {
    win32: "On Windows, better-sqlite3 may need Visual Studio Build Tools + Python 3. Install via https://github.com/nodejs/node-gyp#on-windows, or downgrade to Node 20 LTS which has broader prebuilt coverage.",
    linux: "On Linux, install build-essential and python3 (e.g. apt: sudo apt install build-essential python3), then retry.",
    darwin: "On macOS, install Xcode Command Line Tools (xcode-select --install), then retry.",
};
export function platformHint() {
    return PLATFORM_HINTS[process.platform] || "";
}
async function main() {
    const root = process.env.SUPERBRAIN_PLUGIN_ROOT || process.cwd();
    // Conjoined check: skip only when BOTH the per-install sentinel exists AND
    // the better-sqlite3 native binding is actually present in this install.
    // Without the depsPresent half, a stale sentinel from an earlier plugin
    // version (or a Node ABI change) traps the new install in a permanent
    // "bootstrap pending" state — bootstrap fires, sees sentinel, exits,
    // depsPresent stays false forever. See PR for the Node 25 / 0.3.0 trap.
    if (bootstrapDone(root) && depsPresent(root)) {
        console.log("bootstrap already done");
        process.exit(0);
    }
    if (!acquireLock("bootstrap", { maxAgeMs: 20 * 60 * 1000 })) {
        process.exit(0);
    }
    try {
        if (process.env.SUPERBRAIN_BOOTSTRAP_FAKE === "1") {
            markBootstrapDone(root);
            return;
        }
        // Step 1: npm ci
        try {
            execFileSync("npm", ["ci", "--omit=dev"], { cwd: root, stdio: "ignore" });
        }
        catch (e) {
            writeFailure(`bootstrap step 1 (npm ci) failed: ${e?.message || e}. Check your network / proxy settings and retry.`);
            return;
        }
        // Step 2: rebuild better-sqlite3 native binding
        // `npm ci` does NOT guarantee better-sqlite3's native addon: on a Node
        // ABI with no published prebuild it leaves the package source-only.
        // Force a source rebuild so the binding is compiled for this Node runtime.
        try {
            execFileSync("npm", ["rebuild", "better-sqlite3"], { cwd: root, stdio: "ignore" });
        }
        catch (e) {
            writeFailure(`bootstrap step 2 (better-sqlite3 native build) failed: ${e?.message || e}. ${platformHint()}`);
            return;
        }
        // Step 3: verify the binding actually loads under this Node runtime
        // Only mark done if it genuinely works — otherwise the sentinel fires
        // and SessionStart retries next session.
        try {
            execFileSync(process.execPath, ["-e", "require(require('node:path').join(process.cwd(),'node_modules','better-sqlite3'))"], { cwd: root, stdio: "ignore" });
        }
        catch (e) {
            writeFailure(`bootstrap step 3 (better-sqlite3 binding verify) failed: ${e?.message || e}. The native binding built but won't load under Node ${process.version}. Check ABI compatibility — if you're on Node 25, downgrade to Node 22 or 20 LTS.`);
            return;
        }
        markBootstrapDone(root);
        // Step 4: pre-fetch the embedding model now, while we already have a
        // background process, so semantic recall is ready next session instead of
        // racing a fragile lazy download inside a short-lived hook.
        try {
            const { ensureModelAssets } = await import("../src/staticEmbed/modelCache.js");
            await ensureModelAssets();
        }
        catch (e) {
            writeFailure(`bootstrap step 4 (model prefetch) failed (non-fatal; recall stays keyword-only until it succeeds): ${e?.message || e}`);
        }
        // After successful bootstrap, check for legacy vault state and auto-run
        // the safe (idempotent) frontmatter backfill in a detached subprocess.
        try {
            const { detectLegacyState } = await import("../src/migrationDetect.js");
            const vault = vaultPath();
            const db = path.join(dataDir(), "index.db");
            const state = await detectLegacyState(vault, db);
            if (state.frontmatterMissing > 0) {
                console.log(`SuperBrain: backfilling frontmatter on ${state.frontmatterMissing} legacy notes (detached, ~30s)`);
                const child = spawn("npx", ["tsx", "scripts/backfill-frontmatter.ts", vault, "--apply"], { cwd: root, detached: true, stdio: "ignore" });
                child.unref();
            }
        }
        catch (e) {
            writeFailure(`bootstrap migration check failed (non-fatal): ${e?.message || e}`);
        }
    }
    catch (e) {
        writeFailure(`bootstrap failed (unexpected error): ${e?.message || e}`);
    }
    finally {
        releaseLock("bootstrap");
    }
    process.exit(0);
}
if ((process.argv[1] && process.argv[1].endsWith("sb-bootstrap.ts")) || process.argv[1]?.endsWith("sb-bootstrap.js"))
    main();
