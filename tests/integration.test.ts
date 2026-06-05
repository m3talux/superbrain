import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIST_CHECKPOINT = path.resolve("dist/bin/sb-checkpoint.js");

let TMP_DATA: string;
let TMP_VAULT: string;
let TMP_BIN: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-int-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-int-vault-"));
  TMP_BIN = fs.mkdtempSync(path.join(os.tmpdir(), "sb-int-bin-"));
  // fake `claude` that prints a JSON array (mimics distiller LLM output)
  // Body must contain required decision sections so classify() accepts it.
  fs.writeFileSync(path.join(TMP_BIN, "claude"),
    '#!/usr/bin/env bash\n' +
    'echo \'[{"kind":"decision","title":"Use X","project":"test","date":"2026-05-19","links":[],' +
    '"body":"## Decision\\nUse X.\\n\\n## Why\\n- Best fit.\\n\\n## Alternatives considered\\n- **Alt A** \\u2014 rejected because cost.\\n\\n## Consequences\\n- Trade-offs apply."}]\'\n');
  fs.chmodSync(path.join(TMP_BIN, "claude"), 0o755);
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  fs.rmSync(TMP_BIN, { recursive: true, force: true });
});

it("real checkpoint path (no fake seam) writes a vault note and releases the lock", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.pending"), "1");
  execFileSync("node", [DIST_CHECKPOINT], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "Stop", cwd: "/p", transcript_path: "/dev/null" }),
    env: { ...process.env, PATH: `${TMP_BIN}:${process.env.PATH}`,
      SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT, SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  // checkpoint spawns the detached distiller; poll for completion rather than a
  // fixed sleep — a cold embedding-model load can take several seconds on CI.
  const deadline = Date.now() + 20000;
  let found = false;
  let lockReleased = false;
  while (Date.now() < deadline) {
    found = fs.existsSync(TMP_VAULT) && fs.readdirSync(TMP_VAULT, { recursive: true } as any)
      .some((f: any) => String(f).endsWith(".md"));
    lockReleased = !fs.existsSync(path.join(TMP_DATA, "locks/distill.lock"));
    if (found && lockReleased) break;
    execFileSync("bash", ["-c", "sleep 0.5"]);
  }
  expect(found).toBe(true);
  expect(lockReleased).toBe(true);
}, 25000);
