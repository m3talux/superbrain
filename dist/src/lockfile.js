import fs from "node:fs";
import path from "node:path";
import { lockDir } from "./paths.js";
export function acquireLock(name, opts = {}) {
    const dir = lockDir(name);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    try {
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
        return true;
    }
    catch {
        const maxAgeMs = opts.maxAgeMs ?? 15 * 60 * 1000;
        try {
            const age = Date.now() - fs.statSync(dir).mtimeMs;
            if (age > maxAgeMs) {
                releaseLock(name);
                fs.mkdirSync(dir);
                return true;
            }
        }
        catch { /* race: someone removed it */ }
        return false;
    }
}
export function releaseLock(name) {
    fs.rmSync(lockDir(name), { recursive: true, force: true });
}
