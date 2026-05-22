import fs from "node:fs";
import path from "node:path";
export function snapshotPath(transcriptsDir, sid) {
    return path.join(transcriptsDir, `${sid}.jsonl`);
}
export function snapshotTranscript(transcriptsDir, sid, source) {
    fs.mkdirSync(transcriptsDir, { recursive: true });
    const dest = snapshotPath(transcriptsDir, sid);
    fs.copyFileSync(source, dest);
    return dest;
}
export function gcTranscript(transcriptsDir, sid) {
    const p = snapshotPath(transcriptsDir, sid);
    try {
        fs.rmSync(p, { force: true });
    }
    catch { /* ignore */ }
}
