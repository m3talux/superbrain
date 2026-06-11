import fs from "node:fs";
import path from "node:path";
import { sessionsDir } from "./paths.js";
import { writeFailure } from "./sentinel.js";
import { readCursor } from "./cursor.js";

const FLAG_EXT = ".needs-distill";

export function flagPath(sid: string): string {
  return path.join(sessionsDir(), `${sid}${FLAG_EXT}`);
}

export function listFlaggedSessions(): string[] {
  try {
    return fs.readdirSync(sessionsDir())
      .filter((f) => f.endsWith(FLAG_EXT))
      .map((f) => f.slice(0, f.length - FLAG_EXT.length));
  } catch { return []; }
}

export function clearFlag(sid: string): void {
  try { fs.rmSync(flagPath(sid), { force: true }); } catch { /* best-effort */ }
}

const NDJSON_EXT = ".ndjson";

export interface OrphanScanOptions { maxIdleMs?: number; now?: number }

export function listOrphanedSessions(excludeSid: string, opts?: OrphanScanOptions): string[] {
  const envHours = Number(process.env.SUPERBRAIN_ORPHAN_IDLE_HOURS);
  const maxIdleMs = opts?.maxIdleMs
    ?? (Number.isFinite(envHours) && envHours >= 0 ? envHours : 3) * 3_600_000;
  const now = opts?.now ?? Date.now();
  let entries: string[];
  try { entries = fs.readdirSync(sessionsDir()); } catch { return []; }
  const out: string[] = [];
  for (const f of entries) {
    if (!f.endsWith(NDJSON_EXT)) continue;
    const sid = f.slice(0, -NDJSON_EXT.length);
    if (sid === excludeSid) continue;
    try {
      const st = fs.statSync(path.join(sessionsDir(), f));
      if (now - st.mtimeMs < maxIdleMs) continue;
      if (st.size > readCursor(sid)) out.push(sid);
    } catch { /* unreadable entry — skip */ }
  }
  return out;
}

export async function sweepPendingDistills(
  excludeSid: string,
  distillOne: (sid: string) => Promise<void>,
): Promise<void> {
  for (const sid of listFlaggedSessions()) {
    if (sid === excludeSid) { clearFlag(sid); continue; }
    try {
      await distillOne(sid);
      clearFlag(sid);
    } catch (e: any) {
      writeFailure(`sweep distill failed for ${sid}: ${e?.message || e}`);
    }
  }
}
