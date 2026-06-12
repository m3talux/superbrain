import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
export function atomicWrite(file: string, content: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
export function readWithChecksum(file: string): { content: string; checksum: string } | null {
  try {
    const content = fs.readFileSync(file, "utf8");
    return { content, checksum: sha256(content) };
  } catch { return null; }
}

export interface CasResult { ok: boolean; attempts: number }

export function casWrite(
  file: string,
  produce: (current: string | null) => string,
  opts: { maxAttempts?: number } = {},
): CasResult {
  const maxAttempts = opts.maxAttempts ?? 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const before = readWithChecksum(file);
    const next = produce(before ? before.content : null);
    const after = readWithChecksum(file);
    const beforeSum = before ? before.checksum : null;
    const afterSum = after ? after.checksum : null;
    if (beforeSum === afterSum) {
      atomicWrite(file, next);
      return { ok: true, attempts: attempt };
    }
  }
  // Contention never settled. The old fallback blindly overwrote here, clobbering
  // whichever concurrent writer last touched the file (and through a TOCTOU
  // window at that). Decline instead: leave the peer's data intact and report
  // failure so the caller can retry rather than silently lose the other write.
  return { ok: false, attempts: maxAttempts };
}
