import { execFileSync } from "node:child_process";
export const HEARTBEAT_STALE_MS = 3_600_000;
export function heartbeatWarning(state, opts = {}) {
    const staleMs = opts.staleMs ?? HEARTBEAT_STALE_MS;
    if (!state.dirty)
        return null;
    if (state.headAgeMs === null)
        return null;
    if (state.headAgeMs < staleMs)
        return null;
    const mins = Math.floor(state.headAgeMs / 60_000);
    return `SuperBrain: vault has uncommitted changes and its last auto-commit is ${mins}m old. The com.alex.vault-sync agent may be unloaded. Reload: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.alex.vault-sync.plist`;
}
export function probeVaultGit(vaultDir) {
    try {
        const status = execFileSync("git", ["status", "--porcelain"], {
            cwd: vaultDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 2_000,
        });
        const dirty = status.trim().length > 0;
        let headAgeMs = null;
        try {
            const ct = execFileSync("git", ["log", "-1", "--format=%ct"], {
                cwd: vaultDir,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
                timeout: 2_000,
            }).trim();
            if (ct)
                headAgeMs = Date.now() - Number(ct) * 1000;
        }
        catch {
            headAgeMs = null;
        }
        return { dirty, headAgeMs };
    }
    catch {
        return { dirty: false, headAgeMs: null };
    }
}
