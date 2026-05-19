#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readDelta } from "../src/ndjson.js";
import { readCursor, writeCursor } from "../src/cursor.js";
import { route, type DistilledItem } from "../src/router.js";
import { writeNote } from "../src/vaultWriter.js";
import { releaseLock } from "../src/lockfile.js";
import { writeFailure } from "../src/sentinel.js";
import { vaultPath } from "../src/paths.js";
import { markRollup } from "../src/rollupState.js";
import { indexNote } from "../src/indexer.js";

export interface DistilledEnvelope {
  items: DistilledItem[];
  digest?: string;
  openThreads: string[];
  alsoDid: string[];
}

export function parseEnvelope(raw: string): DistilledEnvelope {
  let v: any;
  try {
    const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    v = JSON.parse(m ? m[0] : raw);
  } catch { return { items: [], openThreads: [], alsoDid: [] }; }
  if (Array.isArray(v)) return { items: v as DistilledItem[], openThreads: [], alsoDid: [] };
  return {
    items: Array.isArray(v.items) ? v.items as DistilledItem[] : [],
    digest: typeof v.digest === "string" ? v.digest : undefined,
    openThreads: Array.isArray(v.openThreads) ? v.openThreads : [],
    alsoDid: Array.isArray(v.alsoDid) ? v.alsoDid : [],
  };
}

function getEnvelope(deltaJson: string): DistilledEnvelope {
  const stub = process.env.SUPERBRAIN_DISTILL_STUB;
  if (stub) return parseEnvelope(fs.readFileSync(stub, "utf8"));
  const prompt =
    "You are SuperBrain's distiller. Given this JSON array of session events and " +
    "salient markers (including 'pushback' markers), output ONLY a JSON object: " +
    '{"items":[{kind:"decision|project_fact|person|gotcha|capture|lesson|preference",' +
    "title,body,date(YYYY-MM-DD),links:[],project?,person?,rule?}]," +
    '"digest"?:string,"openThreads"?:[string],"alsoDid"?:[string]}. ' +
    "Emit a lesson ONLY if the pushback implies a generalizable rule (skip one-off " +
    "fixes); a generalizable lesson sets rule and ALSO emits exactly one preference " +
    "item whose body is the FULL reconciled preferences doc (you are given the current " +
    "one below). Skip ephemeral noise. Events:\n" + deltaJson;
  const out = execFileSync("claude", ["-p", prompt], { encoding: "utf8" });
  return parseEnvelope(out);
}

function appendLog(title: string, rel: string) {
  const p = path.join(vaultPath(), "log.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  fs.appendFileSync(p, `## [${stamp}] write | ${title} | [[${rel.replace(/\.md$/, "")}]]\n`);
}

function getRollupItems(logContent: string, key: string): DistilledItem[] {
  const stub = process.env.SUPERBRAIN_DISTILL_STUB;
  if (stub) return parseEnvelope(fs.readFileSync(stub, "utf8")).items;
  const prompt =
    `You are SuperBrain's daily rollup synthesizer. Given this activity log for ${key}, ` +
    'output ONLY a JSON object {"items":[{"kind":"capture","title":"Daily ' + key + '",' +
    `"body":"<synthesis>","date":"${key}","links":[]}]}. Activity log:\n` + logContent;
  const out = execFileSync("claude", ["-p", prompt], { encoding: "utf8" });
  return parseEnvelope(out).items;
}

async function mainRollup(rollupEnv: string) {
  // Format: daily:<key>:<hash>
  const parts = rollupEnv.split(":");
  // parts[0] = "daily", parts[1] = key (YYYY-MM-DD), parts[2] = hash
  const kind = parts[0] as "daily";
  const key = parts[1];
  const hash = parts[2];

  try {
    const logFile = path.join(vaultPath(), "log.md");
    let logContent = "";
    try { logContent = fs.readFileSync(logFile, "utf8"); } catch { /* absent is fine */ }

    const items = getRollupItems(logContent, key);
    for (const it of items) {
      const r = route(it);
      const res = writeNote(r.relPath, { frontmatter: r.frontmatter, body: r.body, mode: r.mode });
      if (res.ok) {
        appendLog(it.title || it.kind, r.relPath);
        try { await indexNote(r.relPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
      }
    }
    // Mark rollup complete only on success
    markRollup(kind, key, hash);
  } catch (e: any) {
    writeFailure(`distill rollup failed: ${e?.message || e}`);
  } finally {
    releaseLock("distill");
  }
  process.exit(0);
}

async function main() {
  const rollupEnv = process.env.SUPERBRAIN_ROLLUP;
  if (rollupEnv) {
    await mainRollup(rollupEnv);
    return;
  }

  const sid = process.env.SUPERBRAIN_SESSION_ID
    || (() => { try { return JSON.parse(fs.readFileSync(0, "utf8")).session_id; } catch { return "unknown"; } })();
  try {
    const from = readCursor(sid);
    const { events, newOffset } = readDelta(sid, from);
    if (events.length === 0) { releaseLock("distill"); process.exit(0); }
    const env = getEnvelope(JSON.stringify(events));
    const items = env.items;
    for (const it of items) {
      const r = route(it);
      const res = writeNote(r.relPath, { frontmatter: r.frontmatter, body: r.body, mode: r.mode });
      if (res.ok) {
        appendLog(it.title || it.kind, r.relPath);
        try { await indexNote(r.relPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
      }
    }
    writeCursor(sid, newOffset);
  } catch (e: any) {
    writeFailure(`distill failed: ${e?.message || e}`);
  } finally {
    releaseLock("distill");
  }
  process.exit(0);
}
// Run main() only when executed as a script (not imported by tests)
if (process.argv[1] && (process.argv[1].endsWith("sb-distill.ts") || process.argv[1].endsWith("sb-distill.js"))) main();
