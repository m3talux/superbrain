import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
export function sha256(s) {
    return crypto.createHash("sha256").update(s).digest("hex");
}
export function atomicWrite(file, content) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
    const fd = fs.openSync(tmp, "w");
    try {
        fs.writeSync(fd, content);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
}
export function readWithChecksum(file) {
    try {
        const content = fs.readFileSync(file, "utf8");
        return { content, checksum: sha256(content) };
    }
    catch {
        return null;
    }
}
