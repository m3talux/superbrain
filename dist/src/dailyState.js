import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";
import { atomicWrite } from "./atomicWrite.js";
function fileFor(date) {
    return path.join(dataDir(), "daily", `${date}.json`);
}
export function readDay(date) {
    try {
        return JSON.parse(fs.readFileSync(fileFor(date), "utf8"));
    }
    catch {
        return {};
    }
}
export function upsertDay(date, sessionId, entry) {
    const cur = readDay(date);
    cur[sessionId] = entry;
    // atomic: a kill mid-write must never leave truncated JSON that readDay
    // silently swallows as {} (losing the whole day's session entries).
    atomicWrite(fileFor(date), JSON.stringify(cur));
}
export function childrenOf(date, parentId) {
    if (!parentId)
        return [];
    const day = readDay(date);
    return Object.keys(day)
        .filter((sid) => day[sid].parentSessionId === parentId)
        .sort()
        .map((sid) => ({ sessionId: sid, entry: day[sid] }));
}
