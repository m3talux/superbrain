import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";
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
    const f = fileFor(date);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const cur = readDay(date);
    cur[sessionId] = entry;
    fs.writeFileSync(f, JSON.stringify(cur));
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
