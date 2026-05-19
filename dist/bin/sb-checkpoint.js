#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { dataDir } from "../src/paths.js";
import { acquireLock, releaseLock } from "../src/lockfile.js";
import { writeFailure } from "../src/sentinel.js";
import { isChild, buildDistillCommand } from "../src/distillerEngine.js";
function readStdin() { try {
    return fs.readFileSync(0, "utf8");
}
catch {
    return "";
} }
function main() {
    if (isChild())
        process.exit(0);
    try {
        let h;
        try {
            h = JSON.parse(readStdin());
        }
        catch {
            process.exit(0);
        }
        const sid = h.session_id || "unknown";
        const event = h.hook_event_name;
        const pendingFile = path.join(dataDir(), "sessions", `${sid}.pending`);
        // Stop only acts when a salience marker is pending. PreCompact/SessionEnd always act.
        if (event === "Stop" && !fs.existsSync(pendingFile))
            process.exit(0);
        // Fast (<100ms) durable copy of the transcript so async distill can never lose it.
        let copy = "";
        try {
            if (h.transcript_path && fs.existsSync(h.transcript_path) && fs.statSync(h.transcript_path).isFile()) {
                const dir = path.join(dataDir(), "transcripts");
                fs.mkdirSync(dir, { recursive: true });
                copy = path.join(dir, `${sid}.${Date.now()}.jsonl`);
                fs.copyFileSync(h.transcript_path, copy);
            }
        }
        catch { /* transcript copy best-effort */ }
        if (!acquireLock("distill"))
            process.exit(0); // another distill in flight; cursor covers us next time
        try {
            if (process.env.SUPERBRAIN_FAKE_DISTILLER === "1") {
                fs.writeFileSync(path.join(dataDir(), "distill-invoked"), String(event));
                releaseLock("distill");
            }
            else {
                // Spawn the real writer: node dist/bin/sb-distill.js
                // It runs claude -p itself (getItems), routes/writes/logs/advances cursor/releases lock.
                const rawCwd = h.cwd || process.cwd();
                const safeCwd = (rawCwd && fs.existsSync(rawCwd)) ? rawCwd : process.cwd();
                const spec = buildDistillCommand({ sessionId: sid, cwd: safeCwd });
                const child = spawn(spec.cmd, spec.args, spec.options);
                child.on("error", (e) => { writeFailure(`distiller spawn failed: ${e.message}`); releaseLock("distill"); });
                child.unref(); // detached; sb-distill releases the lock when done
            }
            if (fs.existsSync(pendingFile))
                fs.rmSync(pendingFile, { force: true });
        }
        catch (e) {
            writeFailure(`checkpoint error: ${e?.message || e}`);
            releaseLock("distill");
        }
        process.exit(0); // NEVER block compaction / the turn
    }
    catch {
        process.exit(0); // a checkpoint hook must never crash the session
    }
}
main();
