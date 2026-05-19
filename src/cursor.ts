import fs from "node:fs";
import path from "node:path";
import { cursorPath } from "./paths.js";

export function readCursor(sessionId: string): number {
  try {
    const n = parseInt(fs.readFileSync(cursorPath(sessionId), "utf8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}
export function writeCursor(sessionId: string, offset: number): void {
  const p = cursorPath(sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(offset));
}
