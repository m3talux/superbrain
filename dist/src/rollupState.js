import fs from "node:fs";
import path from "node:path";
import { rollupStatePath } from "./paths.js";
function load() {
    try {
        return JSON.parse(fs.readFileSync(rollupStatePath(), "utf8"));
    }
    catch {
        return {};
    }
}
function save(s) {
    const p = rollupStatePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(s, null, 2));
}
export function needsRollup(kind, key, sourceHash) {
    return load()[`${kind}:${key}`] !== sourceHash;
}
export function markRollup(kind, key, sourceHash) {
    const s = load();
    s[`${kind}:${key}`] = sourceHash;
    save(s);
}
