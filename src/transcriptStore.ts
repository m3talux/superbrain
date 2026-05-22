import fs from "node:fs";
import path from "node:path";

export function snapshotPath(transcriptsDir: string, sid: string): string {
  return path.join(transcriptsDir, `${sid}.jsonl`);
}

export function snapshotTranscript(transcriptsDir: string, sid: string, source: string): string {
  fs.mkdirSync(transcriptsDir, { recursive: true });
  const dest = snapshotPath(transcriptsDir, sid);
  fs.copyFileSync(source, dest);
  return dest;
}

export function gcTranscript(transcriptsDir: string, sid: string): void {
  const p = snapshotPath(transcriptsDir, sid);
  try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
}
