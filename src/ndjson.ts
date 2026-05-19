import fs from "node:fs";
import path from "node:path";
import { sessionNdjsonPath } from "./paths.js";

export function appendEvent(sessionId: string, obj: unknown): void {
  const p = sessionNdjsonPath(sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(obj) + "\n");
}

export function readDelta(sessionId: string, fromOffset: number): { events: any[]; newOffset: number } {
  const p = sessionNdjsonPath(sessionId);
  if (!fs.existsSync(p)) return { events: [], newOffset: 0 };
  const fd = fs.openSync(p, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (fromOffset >= size) return { events: [], newOffset: size };
    const len = size - fromOffset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, fromOffset);
    const events = buf.toString("utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x) => x !== null);
    return { events, newOffset: size };
  } finally { fs.closeSync(fd); }
}
