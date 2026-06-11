import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { lockDir } from "./paths.js";

const owned = new Map<string, string>();

function readToken(dir: string): string | null {
  try { return fs.readFileSync(path.join(dir, "token"), "utf8"); } catch { return null; }
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
      if (age > maxAgeMs) {
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
