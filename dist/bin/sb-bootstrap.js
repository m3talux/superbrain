#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { acquireLock, releaseLock } from "../src/lockfile.js";
import { bootstrapDone, markBootstrapDone, depsPresent } from "../src/bootstrap.js";
import { writeFailure } from "../src/sentinel.js";
const PLATFORM_HINTS = {
    win32: "On Windows, better-sqlite3 may need Visual Studio Build Tools + Python 3. Install via https://github.com/nodejs/node-gyp#on-windows, or downgrade to Node 20 LTS which has broader prebuilt coverage.",
    linux: "On Linux, install build-essential and python3 (e.g. apt: sudo apt install build-essential python3), then retry.",
    darwin: "On macOS, install Xcode Command Line Tools (xcode-select --install), then retry.",
};
export function platformHint() {
    return PLATFORM_HINTS[process.platform] || "";
}
function main() {
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
