import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const BIN = "/tmp/sb-conv-bin";
beforeEach(() => {
  for (const d of ["/tmp/sb-conv", "/tmp/sb-conv-vault", BIN]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(BIN, { recursive: true });
  // fake claude: append a line to a call-counter file each invocation, print a JSON array
  fs.writeFileSync(`${BIN}/claude`,
    '#!/usr/bin/env bash\necho call >> /tmp/sb-conv/claude-calls\necho \'[{"kind":"capture","title":"Daily 2026-05-18","body":"s","date":"2026-05-18","links":[]}]\'\n');
  fs.chmodSync(`${BIN}/claude`, 0o755);
  fs.mkdirSync("/tmp/sb-conv", { recursive: true });
});

it("daily rollup converges: real path triggers the writer at most once across repeated session starts", () => {
  const env = { ...process.env, PATH: `${BIN}:${process.env.PATH}`,
    CLAUDE_PLUGIN_DATA: "/tmp/sb-conv", SUPERBRAIN_VAULT: "/tmp/sb-conv-vault",
    SUPERBRAIN_EMBED_STUB: "1" };
  const input = JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" });
  for (let i = 0; i < 3; i++) {
    execFileSync("node", ["dist/bin/sb-session-start.js"], { input, env, encoding: "utf8" });
    execFileSync("bash", ["-c", "sleep 2"]);
  }
  const calls = fs.existsSync("/tmp/sb-conv/claude-calls")
    ? fs.readFileSync("/tmp/sb-conv/claude-calls", "utf8").trim().split("\n").filter(Boolean).length : 0;
  // Exactly one rollup synthesis call total (subsequent session starts must NOT re-trigger).
  expect(calls).toBe(1);
  const state = JSON.parse(fs.readFileSync("/tmp/sb-conv/rollup-state.json", "utf8"));
  expect(state["daily:" + new Date(Date.now() - 86400000).toISOString().slice(0,10)]).toBe("v1");
});
