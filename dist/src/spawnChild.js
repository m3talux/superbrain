import { spawn } from "node:child_process";
import { writeFailure } from "./sentinel.js";
// The single detached-spawn primitive. Every fire-and-forget child in
// SuperBrain (distill, reconcile, discover, bootstrap, backfill) goes through
// here so the spawn mechanics and — critically — the failure path are
// identical: a spawn that throws synchronously or emits an async 'error' must
// always reach the sentinel, never vanish silently. Singleton/debounce gating
// stays at the call sites because it is genuinely site-specific (a lock for
// distill, a time-stamp for reconcile, note-existence for discover, a deps
// check for bootstrap) and a one-size gate here would be wrong for most of them.
export function spawnDetachedCommand(name, command, args, env, opts = {}) {
    const handleError = (e) => {
        writeFailure(`${name} spawn failed: ${e.message}`);
        try {
            opts.onError?.(e);
        }
        catch { /* onError is best-effort */ }
    };
    try {
        const child = spawn(command, args, {
            detached: true,
            stdio: "ignore",
            env,
            cwd: opts.cwd,
        });
        child.on("error", handleError);
        child.unref();
        return child;
    }
    catch (e) {
        handleError(e instanceof Error ? e : new Error(String(e)));
        return null;
    }
}
// Convenience wrapper for the common case: a detached Node child running one
// script (the four node-spawned daemons). Backfill, which shells out to
// `npx tsx`, calls spawnDetachedCommand directly.
export function spawnDetachedChild(name, scriptPath, env, opts = {}) {
    return spawnDetachedCommand(name, process.execPath, [scriptPath], env, opts);
}
