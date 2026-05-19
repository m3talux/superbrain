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

function getItems(deltaJson: string): DistilledItem[] {
  const stub = process.env.SUPERBRAIN_DISTILL_STUB;
  if (stub) return JSON.parse(fs.readFileSync(stub, "utf8"));
  const prompt =
    "You are SuperBrain's distiller. Given this JSON array of session events and " +
    "salient markers, output ONLY a JSON array of items: " +
    '{kind:"decision|project_fact|person|gotcha|capture",title,body,date(YYYY-MM-DD),' +
    "links:[],project?,person?}. Capture decisions, project facts, gotchas, people. " +
    "Skip ephemeral noise. Events:\n" + deltaJson;
  const out = execFileSync("claude", ["-p", prompt], { encoding: "utf8" });
  const m = out.match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : [];
}

function appendLog(title: string, rel: string) {
  const p = path.join(vaultPath(), "log.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  fs.appendFileSync(p, `## [${stamp}] write | ${title} | [[${rel.replace(/\.md$/, "")}]]\n`);
}

function getRollupItems(logContent: string, key: string): DistilledItem[] {
  const stub = process.env.SUPERBRAIN_DISTILL_STUB;
  if (stub) return JSON.parse(fs.readFileSync(stub, "utf8"));
  const prompt =
    `You are SuperBrain's daily rollup synthesizer. Given this activity log for ${key}, ` +
    "output ONLY a JSON array containing exactly ONE item: " +
    `{"kind":"capture","title":"Daily ${key}","body":"<synthesis of the day's activity>",` +
    `"date":"${key}","links":[]}. Synthesize the key activities, decisions, and facts from this day. ` +
    "Activity log:\n" + logContent;
  const out = execFileSync("claude", ["-p", prompt], { encoding: "utf8" });
  const m = out.match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : [];
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
    const items = getItems(JSON.stringify(events));
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
main();
