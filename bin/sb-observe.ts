#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { appendEvent } from "../src/ndjson.js";
import { initState, scoreEvent, type SalienceState, type ObsEvent } from "../src/salience.js";
import { isChild } from "../src/distillerEngine.js";
import { dataDir } from "../src/paths.js";

function readStdin(): string {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}
function stateFile(sid: string) { return path.join(dataDir(), "sessions", `${sid}.salience.json`); }
function loadState(sid: string): SalienceState {
  try { return JSON.parse(fs.readFileSync(stateFile(sid), "utf8")); } catch { return initState(); }
}
function saveState(sid: string, s: SalienceState) {
  fs.mkdirSync(path.dirname(stateFile(sid)), { recursive: true });
  fs.writeFileSync(stateFile(sid), JSON.stringify(s));
}

function main() {
  if (isChild()) process.exit(0);
  try {
    const raw = readStdin();
    if (!raw) process.exit(0);
    let h: any; try { h = JSON.parse(raw); } catch { process.exit(0); }
    const sid = h.session_id || "unknown";
    const cwd = h.cwd || process.cwd();

    const ev: ObsEvent = h.hook_event_name === "UserPromptSubmit"
      ? { type: "prompt", cwd, prompt: h.prompt || "" }
      : { type: "tool", cwd, tool: h.tool_name,
          command: h.tool_input?.command, file: h.tool_input?.file_path };

    appendEvent(sid, { ...ev, ts: new Date().toISOString() });

    const r = scoreEvent(loadState(sid), ev);
    saveState(sid, r.state);
    if (r.marker) appendEvent(sid, r.marker);
    if (r.pending) fs.writeFileSync(path.join(dataDir(), "sessions", `${sid}.pending`), "1");
    process.exit(0);
  } catch {
    process.exit(0);
  }
}
main();
