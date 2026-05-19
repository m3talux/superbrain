import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const BIN = "/tmp/sb-int-bin";
const DIST_CHECKPOINT = path.resolve("dist/bin/sb-checkpoint.js");
beforeEach(() => {
  fs.rmSync("/tmp/sb-int", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-int-vault", { recursive: true, force: true });
  fs.rmSync(BIN, { recursive: true, force: true });
  fs.mkdirSync(BIN, { recursive: true });
  // fake `claude` that prints a JSON array (mimics distiller LLM output)
  fs.writeFileSync(`${BIN}/claude`,
    '#!/usr/bin/env bash\necho \'[{"kind":"decision","title":"Use X","body":"why","date":"2026-05-19","links":["SuperBrain"]}]\'\n');
  fs.chmodSync(`${BIN}/claude`, 0o755);
});

it("real checkpoint path (no fake seam) writes a vault note and releases the lock", () => {
  fs.mkdirSync("/tmp/sb-int/sessions", { recursive: true });
  fs.writeFileSync("/tmp/sb-int/sessions/S.ndjson",
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  fs.writeFileSync("/tmp/sb-int/sessions/S.pending", "1");
  execFileSync("node", [DIST_CHECKPOINT], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "Stop", cwd: "/p", transcript_path: "/dev/null" }),
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`,
      CLAUDE_PLUGIN_DATA: "/tmp/sb-int", SUPERBRAIN_VAULT: "/tmp/sb-int-vault" },
    encoding: "utf8",
  });
  // checkpoint spawns the detached writer; give it a moment
  execFileSync("bash", ["-c", "sleep 2"]);
  const vault = "/tmp/sb-int-vault";
  const found = fs.existsSync(vault) && fs.readdirSync(vault, { recursive: true } as any)
    .some((f: any) => String(f).endsWith(".md"));
  expect(found).toBe(true);
  expect(fs.readFileSync(`${vault}/log.md`, "utf8")).toMatch(/Use X/);
  expect(fs.existsSync("/tmp/sb-int/locks/distill.lock")).toBe(false);
});
