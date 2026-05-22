import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface InjectRecord {
  ts: string;
  hook: "SessionStart" | "UserPromptSubmit";
  sid: string;
  tokens: { recall: number; preferences: number; openThreads: number; notices: number };
  total: number;
}

function logDir(): string {
  return process.env.SUPERBRAIN_HOME || path.join(os.homedir(), ".superbrain");
}

function logPath(): string {
  return path.join(logDir(), "inject.log");
}

export function logInject(record: Omit<InjectRecord, "ts" | "total">): void {
  try {
    const total = record.tokens.recall + record.tokens.preferences + record.tokens.openThreads + record.tokens.notices;
    const full: InjectRecord = { ts: new Date().toISOString(), ...record, total };
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath(), JSON.stringify(full) + "\n", "utf8");
  } catch { /* best-effort */ }
}

export function readInjectLog(limit = 50): InjectRecord[] {
  try {
    const raw = fs.readFileSync(logPath(), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    const tail = lines.slice(-limit);
    const records: InjectRecord[] = [];
    for (const line of tail) {
      try { records.push(JSON.parse(line) as InjectRecord); } catch { /* skip malformed */ }
    }
    return records;
  } catch {
    return [];
  }
}

export function summarize(records: InjectRecord[]): {
  count: number;
  byHook: Record<string, { count: number; avg: Record<string, number>; avgTotal: number }>;
} {
  const byHook: Record<string, { count: number; avg: Record<string, number>; avgTotal: number }> = {};
  for (const r of records) {
    if (!byHook[r.hook]) {
      byHook[r.hook] = { count: 0, avg: { recall: 0, preferences: 0, openThreads: 0, notices: 0 }, avgTotal: 0 };
    }
    const entry = byHook[r.hook];
    entry.count++;
    for (const k of Object.keys(r.tokens) as Array<keyof typeof r.tokens>) {
      entry.avg[k] = (entry.avg[k] || 0) + r.tokens[k];
    }
    entry.avgTotal += r.total;
  }
  for (const hook of Object.keys(byHook)) {
    const entry = byHook[hook];
    for (const k of Object.keys(entry.avg)) {
      entry.avg[k] = Math.round(entry.avg[k] / entry.count);
    }
    entry.avgTotal = Math.round(entry.avgTotal / entry.count);
  }
  return { count: records.length, byHook };
}
