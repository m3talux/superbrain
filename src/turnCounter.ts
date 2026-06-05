import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

interface TurnFile { count: number; }

function turnFile(sid: string): string {
  return path.join(dataDir(), "sessions", `${sid}.turns.json`);
}

export function readTurnCount(sid: string): number {
  try {
    const raw = fs.readFileSync(turnFile(sid), "utf8");
    const parsed = JSON.parse(raw) as TurnFile;
    return typeof parsed.count === "number" ? parsed.count : 0;
  } catch { return 0; }
}

export function incrementTurnCount(sid: string): number {
  const current = readTurnCount(sid);
  const next = current + 1;
  writeTurnCount(sid, next);
  return next;
}

export function resetTurnCount(sid: string): void {
  writeTurnCount(sid, 0);
}

function writeTurnCount(sid: string, count: number): void {
  const p = turnFile(sid);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ count }), "utf8");
}
