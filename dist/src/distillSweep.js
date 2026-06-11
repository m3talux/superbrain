import fs from "node:fs";
import path from "node:path";
import { sessionsDir } from "./paths.js";
import { writeFailure } from "./sentinel.js";
import { readCursor } from "./cursor.js";
const FLAG_EXT = ".needs-distill";
export function flagPath(sid) {
    return path.join(sessionsDir(), `${sid}${FLAG_EXT}`);
}
export function listFlaggedSessions() {
    try {
        return fs.readdirSync(sessionsDir())
            .filter((f) => f.endsWith(FLAG_EXT))
            .map((f) => f.slice(0, f.length - FLAG_EXT.length));
    }
    catch {
        return [];
    }
}
export function clearFlag(sid) {
    try {
        fs.rmSync(flagPath(sid), { force: true });
    }
    catch { /* best-effort */ }
}
const NDJSON_EXT = ".ndjson";
const ATTEMPTS_EXT = ".distill-attempts";
// A distill that fails MAX_DISTILL_ATTEMPTS times will fail the next 100 too;
// unbounded retries across reconcile sweeps were the 2026-06-11 runaway burn.
export const MAX_DISTILL_ATTEMPTS = 3;
function attemptsPath(sid) {
    return path.join(sessionsDir(), `${sid}${ATTEMPTS_EXT}`);
}
export function readAttempts(sid) {
    try {
        const n = parseInt(fs.readFileSync(attemptsPath(sid), "utf8").trim(), 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    }
    catch {
        return 0;
    }
}
export function bumpAttempts(sid) {
    const n = readAttempts(sid) + 1;
    try {
        fs.writeFileSync(attemptsPath(sid), String(n));
    }
    catch { /* best-effort */ }
    return n;
}
export function clearAttempts(sid) {
    try {
        fs.rmSync(attemptsPath(sid), { force: true });
    }
    catch { /* best-effort */ }
}
export function listOrphanedSessions(excludeSid, opts) {
    const rawEnv = process.env.SUPERBRAIN_ORPHAN_IDLE_HOURS;
    const envHours = rawEnv && rawEnv.trim() ? Number(rawEnv) : NaN;
    const maxIdleMs = opts?.maxIdleMs
        ?? (Number.isFinite(envHours) && envHours >= 0 ? envHours : 3) * 3_600_000;
    const now = opts?.now ?? Date.now();
    let entries;
    try {
        entries = fs.readdirSync(sessionsDir());
    }
    catch {
        return [];
    }
    const out = [];
    for (const f of entries) {
        if (!f.endsWith(NDJSON_EXT))
            continue;
        const sid = f.slice(0, -NDJSON_EXT.length);
        if (sid === excludeSid)
            continue;
        try {
            const st = fs.statSync(path.join(sessionsDir(), f));
            if (now - st.mtimeMs < maxIdleMs)
                continue;
            if (readAttempts(sid) >= MAX_DISTILL_ATTEMPTS)
                continue;
            if (st.size > readCursor(sid))
                out.push(sid);
        }
        catch { /* unreadable entry — skip */ }
    }
    return out;
}
export async function sweepPendingDistills(excludeSid, distillOne) {
    for (const sid of listFlaggedSessions()) {
        if (sid === excludeSid) {
            clearFlag(sid);
            continue;
        }
        try {
            await distillOne(sid);
            clearFlag(sid);
        }
        catch (e) {
            writeFailure(`sweep distill failed for ${sid}: ${e?.message || e}`);
        }
    }
}
