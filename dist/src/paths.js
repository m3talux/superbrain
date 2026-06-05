import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { markOwned, recordedVaultPath } from "./vaultMarker.js";
// dataDir is hardcoded to ~/.superbrain in production. SUPERBRAIN_DATA_DIR is
// a test-only seam that Claude Code itself never sets — this is what keeps
// production from drifting back to the historical split where hooks (under
// Claude Code's CLAUDE_PLUGIN_DATA) wrote to a hidden per-plugin dir while
// user-invoked entrypoints (migrate, adopt) wrote to ~/.superbrain.
export function dataDir() {
    return process.env.SUPERBRAIN_DATA_DIR || path.join(os.homedir(), ".superbrain");
}
// vaultPath in production: honors a recorded adopt path (/superbrain:adopt
// writes it), else dataDir/vault. SUPERBRAIN_VAULT_DIR is a test-only seam.
export function vaultPath() {
    if (process.env.SUPERBRAIN_VAULT_DIR) {
        const p = process.env.SUPERBRAIN_VAULT_DIR;
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
export function sessionsDir() { return path.join(dataDir(), "sessions"); }
export function sessionNdjsonPath(id) { return path.join(sessionsDir(), `${id}.ndjson`); }
export function cursorPath(id) { return path.join(sessionsDir(), `${id}.cursor`); }
export function sentinelPath() { return path.join(dataDir(), "last-failure.txt"); }
export function lockDir(name) { return path.join(dataDir(), "locks", `${name}.lock`); }
