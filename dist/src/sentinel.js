import fs from "node:fs";
import path from "node:path";
import { sentinelPath } from "./paths.js";
export function writeFailure(message) {
    const p = sentinelPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `[${new Date().toISOString()}] ${message}\n`);
}
export function readAndClearFailure() {
    const p = sentinelPath();
    try {
        const msg = fs.readFileSync(p, "utf8").trim();
        fs.rmSync(p, { force: true });
        return msg || null;
    }
    catch {
        return null;
    }
}
