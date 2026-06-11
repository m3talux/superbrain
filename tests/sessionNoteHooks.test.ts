import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-snh-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-snh-vault-"));
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function runHook(bin: string, payload: any): void {
  execFileSync("npx", ["tsx", bin], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_FAKE_DISTILLER: "1",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
}

function readSessionNote(sid: string): string {
  const rel = fs.readFileSync(path.join(TMP_DATA, "sessions", `${sid}.note`), "utf8").trim();
  return fs.readFileSync(path.join(TMP_VAULT, rel), "utf8");
}

it("UserPromptSubmit appends a prompt line to the session note", () => {
  runHook("bin/sb-recall.ts", { session_id: "SR1", cwd: "/tmp/nowhere", prompt: "fix the login bug" });
  expect(readSessionNote("SR1")).toContain("▸ fix the login bug");
});

it("Stop appends the assistant tail from the transcript", () => {
  const transcript = path.join(TMP_DATA, "t.jsonl");
  fs.writeFileSync(
    transcript,
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "done, tests green" }] } }) + "\n",
  );
  runHook("bin/sb-checkpoint.ts", {
    session_id: "SC1",
    cwd: "/tmp/nowhere",
    hook_event_name: "Stop",
    transcript_path: transcript,
  });
  expect(readSessionNote("SC1")).toContain("↳ done, tests green");
});

it("hooks exit 0 on malformed payloads and write nothing", () => {
  execFileSync("npx", ["tsx", "bin/sb-recall.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT },
    input: "not json",
    encoding: "utf8",
  });
  expect(fs.existsSync(path.join(TMP_VAULT, "sessions"))).toBe(false);
});
