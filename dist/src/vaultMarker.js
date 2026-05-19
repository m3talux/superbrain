import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";
export const MARKER = ".superbrain";
export function isOwned(dir) {
    try {
        return fs.existsSync(path.join(dir, MARKER));
    }
    catch {
        return false;
    }
}
export function markOwned(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, MARKER), "superbrain-owned\n");
}
function recordFile() { return path.join(dataDir(), "vault-path"); }
export function recordedVaultPath() {
    try {
        const p = fs.readFileSync(recordFile(), "utf8").trim();
        return p || undefined;
    }
    catch {
        return undefined;
    }
}
export function setRecordedVaultPath(p) {
    fs.mkdirSync(path.dirname(recordFile()), { recursive: true });
    fs.writeFileSync(recordFile(), p);
}
