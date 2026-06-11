import fs from "node:fs";
import path from "node:path";
// SessionStart fires for every claude invocation on the machine, including
// claude -p one-shots; without a debounce, bursty spawners (watchers, scripts,
// CI) stack reconcile daemons faster than they finish.
export const RECONCILE_DEBOUNCE_MS = 10 * 60 * 1000;
export function shouldSpawnReconcile(dataDirPath, now = Date.now()) {
    const stamp = path.join(dataDirPath, "reconcile-stamp");
    try {
        if (now - fs.statSync(stamp).mtimeMs < RECONCILE_DEBOUNCE_MS)
            return false;
    }
    catch { /* no stamp yet */ }
    try {
        fs.mkdirSync(dataDirPath, { recursive: true });
        fs.writeFileSync(stamp, String(now));
        fs.utimesSync(stamp, now / 1000, now / 1000);
    }
    catch { /* best-effort */ }
    return true;
}
