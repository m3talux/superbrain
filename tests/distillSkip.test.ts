import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { shouldSkipDistill } from "../src/distillRun";

const TMP = path.join(os.tmpdir(), `sb-skip-${process.pid}`);

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

describe("shouldSkipDistill — pure helper", () => {
  it("skips an empty delta", () => {
    expect(shouldSkipDistill([]).skip).toBe(true);
  });

  it("skips a session with only a couple of read-only tool calls and one prompt", () => {
    const events = [
      { type: "prompt", prompt: "What is X?" },
      { type: "tool", tool: "Read", file: "/p/x.md" },
      { type: "tool", tool: "mcp__lean-ctx__ctx_read", file: "/p/y.md" },
    ];
    const r = shouldSkipDistill(events);
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/low-signal/);
  });

  it("does NOT skip when a file write happened", () => {
    const events = [
      { type: "prompt", prompt: "Fix the bug" },
      { type: "tool", tool: "Write", file: "/p/a.ts" },
    ];
    expect(shouldSkipDistill(events).skip).toBe(false);
  });

  it("does NOT skip when an Edit happened", () => {
    const events = [
      { type: "tool", tool: "Edit", file: "/p/a.ts" },
    ];
    expect(shouldSkipDistill(events).skip).toBe(false);
  });

  it("does NOT skip when a Bash command ran", () => {
    const events = [
      { type: "prompt", prompt: "Build it" },
      { type: "tool", tool: "Bash", command: "npm test" },
    ];
    expect(shouldSkipDistill(events).skip).toBe(false);
  });

  it("does NOT skip when a salience marker is present (pushback)", () => {
    const events = [
      { type: "prompt", prompt: "No, the OTHER file" },
      { type: "marker", reason: "pushback" },
    ];
    expect(shouldSkipDistill(events).skip).toBe(false);
  });

  it("does NOT skip on a long back-and-forth session even without writes", () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0 ? { type: "prompt", prompt: `q${i}` } : { type: "tool", tool: "Read", file: `/p/${i}.md` }
    );
    expect(shouldSkipDistill(events).skip).toBe(false);
  });

  it("does NOT skip when there are >= 2 prompts (multi-turn deliberation)", () => {
    const events = [
      { type: "prompt", prompt: "q1" },
      { type: "tool", tool: "Read" },
      { type: "prompt", prompt: "q2" },
      { type: "tool", tool: "Read" },
    ];
    expect(shouldSkipDistill(events).skip).toBe(false);
  });
});

describe("runDistill end-to-end skip integration", () => {
  it("does NOT spawn claude -p for a low-signal session; advances cursor; writes distill.log skip line", () => {
    const data = path.join(TMP, "data");
    const vault = path.join(TMP, "vault");
    fs.mkdirSync(path.join(data, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(data, "sessions", "S.ndjson"),
      JSON.stringify({ type: "prompt", prompt: "What is this repo?", cwd: "/p", ts: "t" }) + "\n" +
      JSON.stringify({ type: "tool", tool: "Read", file: "/p/README.md", cwd: "/p", ts: "t" }) + "\n");
    // Lock dir present so the test exercises the release path on skip too.
    fs.mkdirSync(path.join(data, "locks", "distill.lock"), { recursive: true });
    // Set a stub that would CRASH if claude -p were invoked — we want to
    // assert the skip happened BEFORE any LLM-equivalent call. We do this by
    // NOT setting SUPERBRAIN_DISTILL_STUB (which would bypass the skip
    // check) and instead asserting the cursor moved and no notes were written.
    execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
      env: { ...process.env,
        SUPERBRAIN_DATA_DIR: data, SUPERBRAIN_VAULT_DIR: vault,
        SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
      encoding: "utf8",
    });
    // Cursor advanced past the delta.
    expect(fs.existsSync(path.join(data, "sessions", "S.cursor"))).toBe(true);
    const cursorBytes = Number(fs.readFileSync(path.join(data, "sessions", "S.cursor"), "utf8"));
    expect(cursorBytes).toBeGreaterThan(0);
    // No vault notes written (skip path).
    expect(fs.existsSync(path.join(vault, "decisions"))).toBe(false);
    expect(fs.existsSync(path.join(vault, "capture"))).toBe(false);
    // Skip log line exists.
    const logPath = path.join(data, "distill.log");
    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.readFileSync(logPath, "utf8")).toMatch(/skip S: low-signal delta/);
    // Lock released.
    expect(fs.existsSync(path.join(data, "locks", "distill.lock"))).toBe(false);
  });

  it("STILL runs the stubbed envelope when SUPERBRAIN_DISTILL_STUB is set (test seam bypasses skip)", () => {
    const data = path.join(TMP, "data2");
    const vault = path.join(TMP, "vault2");
    fs.mkdirSync(path.join(data, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(data, "sessions", "S.ndjson"),
      JSON.stringify({ type: "prompt", prompt: "tiny", cwd: "/p", ts: "t" }) + "\n");
    fs.mkdirSync(path.join(data, "locks", "distill.lock"), { recursive: true });
    const stub = path.join(TMP, "stub.json");
    fs.writeFileSync(stub, JSON.stringify({ items: [
      { kind: "decision", title: "Forced", body: "via stub", date: "2026-05-20", links: [] }
    ]}));
    execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
      env: { ...process.env,
        SUPERBRAIN_DATA_DIR: data, SUPERBRAIN_VAULT_DIR: vault,
        SUPERBRAIN_DISTILL_STUB: stub,
        SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
      encoding: "utf8",
    });
    // The stub envelope was applied — decision file should exist.
    expect(fs.existsSync(path.join(vault, "decisions", "2026-05-20-forced.md"))).toBe(true);
  });
});
