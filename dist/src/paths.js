import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { markOwned, recordedVaultPath } from "./vaultMarker.js";
export function dataDir() {
    return process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".superbrain");
}
export function vaultPath() {
    if (process.env.SUPERBRAIN_VAULT) {
        const p = process.env.SUPERBRAIN_VAULT;
        markOwned(p);
        return p;
    }
    const rec = recordedVaultPath();
    if (rec)
        return rec;
    const owned = path.join(dataDir(), "vault");
    markOwned(owned);
    return owned;
}
export function pluginRoot() {
    if (process.env.CLAUDE_PLUGIN_ROOT)
        return process.env.CLAUDE_PLUGIN_ROOT;
    // dist/src/paths.js -> plugin root is the dir containing package.json above it.
    let d = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) {
        if (fs.existsSync(path.join(d, "package.json")))
            return d;
        d = path.dirname(d);
    }
    return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}
function sessionsDir() { return path.join(dataDir(), "sessions"); }
export function sessionNdjsonPath(id) { return path.join(sessionsDir(), `${id}.ndjson`); }
export function cursorPath(id) { return path.join(sessionsDir(), `${id}.cursor`); }
export function sentinelPath() { return path.join(dataDir(), "last-failure.txt"); }
export function rollupStatePath() { return path.join(dataDir(), "rollup-state.json"); }
export function lockDir(name) { return path.join(dataDir(), "locks", `${name}.lock`); }
