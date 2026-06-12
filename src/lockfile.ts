import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { lockDir } from "./paths.js";

const owned = new Map<string, string>();

function readToken(dir: string): string | null {
  try { return fs.readFileSync(path.join(dir, "token"), "utf8"); } catch { return null; }
}

// A lock whose recorded holder is gone should be reclaimed at once rather than
// waiting out the mtime TTL — a crashed distill otherwise wedges every acquirer
// for 15 minutes. Returns true only when the pid is readable AND provably dead;
// an unreadable pid or a PID-reuse ambiguity falls through to the mtime TTL.
function holderIsDead(dir: string): boolean {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(path.join(dir, "pid"), "utf8").trim());
  } catch { return false; }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false; // signal delivered (or EPERM) -> process exists
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

export function acquireLock(name: string, opts: { maxAgeMs?: number } = {}): boolean {
  const dir = lockDir(name);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const token = process.env.SUPERBRAIN_LOCK_TOKEN || crypto.randomUUID();
  try {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
    fs.writeFileSync(path.join(dir, "token"), token);
    owned.set(name, token);
    return true;
  } catch {
    const maxAgeMs = opts.maxAgeMs ?? 15 * 60 * 1000;
    try {
      const age = Date.now() - fs.statSync(dir).mtimeMs;
      if (holderIsDead(dir) || age > maxAgeMs) {
        forceRelease(name);
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
        fs.writeFileSync(path.join(dir, "token"), token);
        owned.set(name, token);
        return true;
      }
    } catch { /* race: someone removed it */ }
    return false;
  }
}

export function releaseLock(name: string, token?: string): void {
  const dir = lockDir(name);
  const onDisk = readToken(dir);
  if (onDisk === null) { forceRelease(name); return; }
  const mine = owned.get(name);
  const presented = token ?? mine;
  if (presented !== undefined && presented === onDisk) { forceRelease(name); }
}

function forceRelease(name: string): void {
  fs.rmSync(lockDir(name), { recursive: true, force: true });
  owned.delete(name);
}
