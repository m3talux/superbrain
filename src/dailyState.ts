import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";
import { atomicWrite } from "./atomicWrite.js";

export interface DaySessionEntry {
  digestLine: string;
  routedRelPaths: string[];
  alsoDid: string[];
  openThreads: string[];
  project?: string;
  projects?: string[];
  parentSessionId?: string;
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
  const cur = readDay(date);
  cur[sessionId] = entry;
  // atomic: a kill mid-write must never leave truncated JSON that readDay
  // silently swallows as {} (losing the whole day's session entries).
  atomicWrite(fileFor(date), JSON.stringify(cur));
}

export interface ChildEntry { sessionId: string; entry: DaySessionEntry; }

export function childrenOf(date: string, parentId: string): ChildEntry[] {
  if (!parentId) return [];
  const day = readDay(date);
  return Object.keys(day)
    .filter((sid) => day[sid].parentSessionId === parentId)
    .sort()
    .map((sid) => ({ sessionId: sid, entry: day[sid] }));
}
