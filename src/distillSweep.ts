import fs from "node:fs";
import path from "node:path";
import { sessionsDir } from "./paths.js";
import { writeFailure } from "./sentinel.js";

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
