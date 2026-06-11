import fs from "node:fs";
import path from "node:path";
import { pruneSessionFiles, pruneSessionNotes } from "./sessionGc.js";
const STAMP_FILE = "session-gc.stamp";
const DEFAULT_MIN_INTERVAL_HOURS = 24;
function envNumber(name, fallback) {
    const raw = process.env[name];
    if (raw == null || raw === "")
        return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? v : fallback;
}
export function runSessionGcOncePerDay(dataDirPath, opts) {
    if (process.env.SUPERBRAIN_GC_DISABLE === "1") {
        return { ran: false, skippedByCadence: false };
    }
    const now = opts?.now ?? Date.now();
    const minIntervalHours = envNumber("SUPERBRAIN_GC_MIN_INTERVAL_HOURS", DEFAULT_MIN_INTERVAL_HOURS);
    const minIntervalMs = minIntervalHours * 60 * 60 * 1000;
    const stampPath = path.join(dataDirPath, STAMP_FILE);
    if (minIntervalMs > 0) {
        try {
            const stat = fs.statSync(stampPath);
            if (now - stat.mtimeMs < minIntervalMs) {
                return { ran: false, skippedByCadence: true };
            }
        }
        catch {
            // no stamp yet — first run
        }
    }
    const maxAgeDays = envNumber("SUPERBRAIN_GC_MAX_AGE_DAYS", 30);
    const dryRun = process.env.SUPERBRAIN_GC_DRY_RUN === "1";
    const result = pruneSessionFiles(dataDirPath, { maxAgeDays, dryRun });
    try {
        pruneSessionNotes({ maxAgeDays, dryRun });
    }
    catch { /* best-effort */ }
    try {
        fs.mkdirSync(dataDirPath, { recursive: true });
        fs.writeFileSync(stampPath, new Date(now).toISOString());
    }
    catch {
        // stamp write failure is non-fatal
    }
    return { ran: true, skippedByCadence: false, result };
}
