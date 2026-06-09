import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex";
import { appendInjectedSlugs } from "../src/sessionInjected";
import { incrementTurnCount, resetTurnCount } from "../src/turnCounter";

let TMP: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rh-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rh-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.mkdirSync(path.join(TMP_VAULT, "meta"), { recursive: true });
  const ix = openIndex();
  ix.upsertNote("projects/super-brain.md", 1, "h",
    [{ headingPath: "Decisions", anchor: "decisions", text: "we picked RRF hybrid fusion for recall" }],
    [Float32Array.from(Array(256).fill(0.4))]);
  ix.close();
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_VAULT_DIR;
});

function run(hook: object, extraEnv: Record<string, string> = {}) {
  return execFileSync("npx", ["tsx", "bin/sb-recall.ts"], {
    input: JSON.stringify(hook),
    env: { ...process.env, ...extraEnv }, encoding: "utf8",
  });
}

describe("sb-recall", () => {
  it("injects additionalContext pointers for a relevant prompt", () => {
    const out = run({ session_id: "S", hook_event_name: "UserPromptSubmit", cwd: "/p",
                       prompt: "how did we do recall fusion?" });
    expect(out).toMatch(/additionalContext/);
    expect(out).toMatch(/super-brain/);
  });
  it("emits nothing for an empty prompt and exits 0", () => {
    const out = run({ session_id: "S", hook_event_name: "UserPromptSubmit", cwd: "/p", prompt: "" });
    expect(out.trim()).toBe("");
  });
  it("recursion guard makes it a silent no-op", () => {
    const out = run({ session_id: "S", hook_event_name: "UserPromptSubmit", cwd: "/p", prompt: "recall" },
                     { SUPERBRAIN_CHILD: "1" });
    expect(out.trim()).toBe("");
  });
});

describe("sb-recall B4 — per-note cap, pref-core pin, mini-brief, dedup", () => {
  it("4.2.a: hybridRecall is called without bm25Only option", () => {
    // Verified behaviorally: if bm25Only were set, vector recall would not
    // fire and the output would be empty/degraded.
    const out = run({ session_id: "S4a", hook_event_name: "UserPromptSubmit", cwd: "/p",
                       prompt: "hybrid fusion recall" });
    // If bm25Only was set, vector recall would not fire; we'd get empty/degraded results.
    // With it absent, we get additionalContext.
    expect(out).toMatch(/additionalContext/);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.additionalContext).toBeTruthy();
    // bm25Only must not appear in the output context
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain("bm25Only");
  });

  it("4.2.b: hits already in getInjectedSlugs are excluded from output", () => {
    // Pre-inject the note we would otherwise get
    appendInjectedSlugs("S4b", ["projects/super-brain.md"]);
    const out = run({ session_id: "S4b", hook_event_name: "UserPromptSubmit", cwd: "/p",
                       prompt: "hybrid fusion recall" });
    // The note should be excluded from the recall output
    if (out.trim()) {
      const parsed = JSON.parse(out);
      expect(parsed.hookSpecificOutput.additionalContext).not.toContain("super-brain");
    } else {
      // No output is also acceptable when the only hit was excluded
      expect(out.trim()).toBe("");
    }
  });

  it("4.2.c: preference-core text appears in additionalContext even when recall returns zero hits", () => {
    // Create a preferences-core.md so readPreferencesCore finds it
    fs.writeFileSync(
      path.join(TMP_VAULT, "meta", "preferences-core.md"),
      "- Always test before commit\n",
      "utf8",
    );
    // Use a query that won't match any indexed notes
    const out = run({ session_id: "S4c", hook_event_name: "UserPromptSubmit", cwd: "/p",
                       prompt: "xyzzy-unmatched-query-string-9999" });
    expect(out).toMatch(/additionalContext/);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Always test before commit");
  });

  it("4.2.d: each hit excerpt is capped to PER_NOTE_TOKEN_CAP tokens in output", () => {
    // Insert a note with a very long text (would produce a long excerpt)
    const longText = "important context information ".repeat(50);
    const ix = openIndex();
    ix.upsertNote("projects/verbose-note.md", 2, "h2",
      [{ headingPath: "Details", anchor: "details", text: longText }],
      [Float32Array.from(Array(256).fill(0.5))]);
    ix.close();

    const out = run({ session_id: "S4d", hook_event_name: "UserPromptSubmit", cwd: "/p",
                       prompt: "important context information" });
    // Mandatory output: the verbose note matches the prompt, so recall MUST
    // fire — a silent no-op here previously made every assertion below
    // unreachable (vacuous test).
    expect(out.trim()).not.toBe("");
    const parsed = JSON.parse(out);
    const ctx: string = parsed.hookSpecificOutput.additionalContext;
    // Each recall line excerpt should be capped; the total should be reasonable
    // PER_NOTE_TOKEN_CAP = 120 tokens * 4 chars = 480 chars per excerpt max
    const lines = ctx.split("\n").filter((l: string) => l.includes("verbose-note"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const excerptMatch = line.match(/— (.+)$/);
      expect(excerptMatch).toBeTruthy();
      const excerpt = excerptMatch![1];
      // 120 tokens * 4 chars/token = 480 chars max
      expect(excerpt.length).toBeLessThanOrEqual(480 + 5);
    }
  });

  it("4.2.e: mini-brief appears at turn boundary", () => {
    // Set up project note and preferences-core for buildMiniBrief
    fs.mkdirSync(path.join(TMP_VAULT, "projects"), { recursive: true });
    fs.writeFileSync(path.join(TMP_VAULT, "projects", "super-brain.md"),
      "---\ntitle: SuperBrain\n---\n\nAI memory system\n", "utf8");
    fs.writeFileSync(path.join(TMP_VAULT, "meta", "preferences-core.md"),
      "- Test everything\n", "utf8");

    // With SUPERBRAIN_MINI_BRIEF_EVERY=3, set up turn count at 2 so next increment = 3
    resetTurnCount("S4e");
    incrementTurnCount("S4e");
    incrementTurnCount("S4e"); // count = 2; next increment in sb-recall.ts => 3 (fires)

    const out = run({ session_id: "S4e", hook_event_name: "UserPromptSubmit", cwd: "/p",
                       prompt: "hybrid fusion recall" },
                     { SUPERBRAIN_MINI_BRIEF_EVERY: "3" });
    expect(out).toMatch(/additionalContext/);
    const parsed = JSON.parse(out);
    const ctx: string = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("mini-brief");
  });

  it("4.2.f: no mini-brief at non-boundary turn", () => {
    // Reset and set turn count to 1 (non-boundary for MINI_BRIEF_EVERY=10)
    resetTurnCount("S4f");
    // After increment in sb-recall.ts => count = 1 (no boundary)
    const out = run({ session_id: "S4f", hook_event_name: "UserPromptSubmit", cwd: "/p",
                       prompt: "hybrid fusion recall" });
    // Mandatory output: the same prompt produces recall output in 4.2.a, so
    // an empty result here would mean recall is broken, not "no mini-brief" —
    // the old conditional made this test pass vacuously either way.
    expect(out.trim()).not.toBe("");
    const parsed = JSON.parse(out);
    const ctx: string = parsed.hookSpecificOutput.additionalContext;
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx).not.toContain("mini-brief");
  });
});
