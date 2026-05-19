import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

export interface DaySessionEntry {
  digestLine: string;
  routedRelPaths: string[];
  alsoDid: string[];
  openThreads: string[];
}
export type DayState = Record<string, DaySessionEntry>;

function fileFor(date: string): string {
  return path.join(dataDir(), "daily", `${date}.json`);
}

export function readDay(date: string): DayState {
  try { return JSON.parse(fs.readFileSync(fileFor(date), "utf8")) as DayState; }
  catch { return {}; }
}

export function upsertDay(date: string, sessionId: string, entry: DaySessionEntry): void {
  const f = fileFor(date);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const cur = readDay(date);
  cur[sessionId] = entry;
  fs.writeFileSync(f, JSON.stringify(cur));
}
