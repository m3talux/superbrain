#!/usr/bin/env -S node --experimental-strip-types
// scripts/recover-lessons.ts
//
// One-shot manual recovery: re-distill past sessions whose lessons/captures were
// lost to the pre-v0.7.0 classification reject regression. Now that the gate
// accepts project-less lessons and coerces sub-rubric notes, re-running the full
// pipeline over old event logs recovers what was dropped.
//
// Usage:
//   npx tsx scripts/recover-lessons.ts [--since YYYY-MM-DD] [--data-dir <path>]  # dry-run
//   npx tsx scripts/recover-lessons.ts --apply [--since YYYY-MM-DD] [--data-dir <path>]

import fs from "node:fs";
import path from "node:path";

const DEFAULT_SINCE = "2026-05-22";

export interface RecoverySession {
  sid: string;
  ndjsonPath: string;
  firstEventDate: string;
}

export interface RecoveryPlan {
  sessionsDir: string;
  since: string;
  sessions: RecoverySession[];
}

export interface RecoveryResult {
  sid: string;
  notesWritten: number;
}

function parseFirstEventDate(ndjsonPath: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(ndjsonPath, "r");
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    const text = buf.slice(0, bytesRead).toString("utf8");
    const firstLine = text.split("\n")[0];
    if (!firstLine) return null;
    const obj = JSON.parse(firstLine);
    const ts: string | undefined = obj?.ts ?? obj?.date ?? obj?.timestamp;
    if (!ts) return null;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best-effort */ }
    }
  }
}

export function planRecovery(sessionsDir: string, since: string): RecoveryPlan {
  const sessions: RecoverySession[] = [];
  if (!fs.existsSync(sessionsDir)) return { sessionsDir, since, sessions };

  for (const entry of fs.readdirSync(sessionsDir)) {
    if (!entry.endsWith(".ndjson")) continue;
    const sid = entry.slice(0, -7);
    const ndjsonPath = path.join(sessionsDir, entry);
    const firstEventDate = parseFirstEventDate(ndjsonPath);
    if (!firstEventDate) continue;
    if (firstEventDate >= since) {
      sessions.push({ sid, ndjsonPath, firstEventDate });
    }
  }

  sessions.sort((a, b) => a.firstEventDate.localeCompare(b.firstEventDate));
  return { sessionsDir, since, sessions };
}

export async function applyRecovery(
  plan: RecoveryPlan,
  distillFn: (sid: string, events: any[]) => Promise<{ notesWritten: number }>,
): Promise<RecoveryResult[]> {
  const results: RecoveryResult[] = [];
  for (const s of plan.sessions) {
    const raw = fs.readFileSync(s.ndjsonPath, "utf8");
    const events = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x) => x !== null);
    const { notesWritten } = await distillFn(s.sid, events);
    results.push({ sid: s.sid, notesWritten });
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx >= 0 && args[sinceIdx + 1] ? args[sinceIdx + 1] : DEFAULT_SINCE;

  const dataDirIdx = args.indexOf("--data-dir");
  let resolvedDataDir: string;
  if (dataDirIdx >= 0 && args[dataDirIdx + 1]) {
    resolvedDataDir = args[dataDirIdx + 1];
  } else {
    const { dataDir } = await import("../src/paths.js");
    resolvedDataDir = dataDir();
  }

  const sessionsDir = path.join(resolvedDataDir, "sessions");
  const plan = planRecovery(sessionsDir, since);

  if (plan.sessions.length === 0) {
    console.log(`No sessions found on/after ${since} in ${sessionsDir}.`);
    return;
  }

  if (!apply) {
    console.log(`Dry-run: ${plan.sessions.length} session(s) on/after ${since} would be re-distilled.`);
    console.log("Each reprocess makes one LLM call. Run with --apply to write notes.\n");
    for (const s of plan.sessions) {
      console.log(`  ${s.sid}  (first event: ${s.firstEventDate})`);
    }
    console.log("\n(Dry-run. Use --apply to write changes.)");
    return;
  }

  console.log(`Recovering ${plan.sessions.length} session(s) on/after ${since}...`);

  const { distillFromEvents } = await import("../src/distillRun.js");
  const results = await applyRecovery(plan, distillFromEvents);

  let totalNotes = 0;
  for (const r of results) {
    console.log(`  ${r.sid}: ${r.notesWritten} note(s) written`);
    totalNotes += r.notesWritten;
  }
  console.log(`\nDone. ${totalNotes} total note(s) written across ${results.length} session(s).`);
}

if (
  process.argv[1]?.endsWith("recover-lessons.ts") ||
  process.argv[1]?.endsWith("recover-lessons.js")
) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
