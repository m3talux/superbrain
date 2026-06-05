import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";
function turnFile(sid) {
    return path.join(dataDir(), "sessions", `${sid}.turns.json`);
}
export function readTurnCount(sid) {
    try {
        const raw = fs.readFileSync(turnFile(sid), "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed.count === "number" ? parsed.count : 0;
    }
    catch {
        return 0;
    }
}
export function incrementTurnCount(sid) {
    const current = readTurnCount(sid);
    const next = current + 1;
    writeTurnCount(sid, next);
    return next;
}
export function resetTurnCount(sid) {
    writeTurnCount(sid, 0);
}
function writeTurnCount(sid, count) {
    const p = turnFile(sid);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ count }), "utf8");
}
