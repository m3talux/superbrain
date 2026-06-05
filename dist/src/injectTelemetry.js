import fs from "node:fs";
import os from "node:os";
import path from "node:path";
function logDir() {
    return process.env.SUPERBRAIN_HOME || path.join(os.homedir(), ".superbrain");
}
function logPath() {
    return path.join(logDir(), "inject.log");
}
export function logInject(record) {
    try {
        const t = record.tokens;
        const total = t.recall + t.preferences + t.openThreads + t.notices + (t.miniBrief ?? 0);
        const full = { ts: new Date().toISOString(), ...record, total };
        const dir = logDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(logPath(), JSON.stringify(full) + "\n", "utf8");
    }
    catch { /* best-effort */ }
}
export function readInjectLog(limit = 50) {
    try {
        const raw = fs.readFileSync(logPath(), "utf8");
        const lines = raw.split("\n").filter((l) => l.trim() !== "");
        const tail = lines.slice(-limit);
        const records = [];
        for (const line of tail) {
            try {
                records.push(JSON.parse(line));
            }
            catch { /* skip malformed */ }
        }
        return records;
    }
    catch {
        return [];
    }
}
export function summarize(records) {
    const byHook = {};
    for (const r of records) {
        if (!byHook[r.hook]) {
            byHook[r.hook] = { count: 0, avg: { recall: 0, preferences: 0, openThreads: 0, notices: 0, miniBrief: 0 }, avgTotal: 0 };
        }
        const entry = byHook[r.hook];
        entry.count++;
        for (const k of Object.keys(r.tokens)) {
            entry.avg[k] = (entry.avg[k] || 0) + r.tokens[k];
        }
        entry.avgTotal += r.total;
    }
    for (const hook of Object.keys(byHook)) {
        const entry = byHook[hook];
        for (const k of Object.keys(entry.avg)) {
            entry.avg[k] = Math.round(entry.avg[k] / entry.count);
        }
        entry.avgTotal = Math.round(entry.avgTotal / entry.count);
    }
    return { count: records.length, byHook };
}
