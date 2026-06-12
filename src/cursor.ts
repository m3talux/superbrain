import fs from "node:fs";
import { cursorPath } from "./paths.js";
import { atomicWrite } from "./atomicWrite.js";

export function readCursor(sessionId: string): number {
  try {
    const n = parseInt(fs.readFileSync(cursorPath(sessionId), "utf8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}
export function writeCursor(sessionId: string, offset: number): void {
  // atomic: a kill mid-write must never truncate the cursor to a value that
  // readCursor coerces to 0 (which would reprocess the entire session).
  atomicWrite(cursorPath(sessionId), String(offset));
}
