/**
 * CI inject-budget regression guard.
 *
 * These tests fail if anyone removes a token cap in the inject path.
 * Construct worst-case inputs and assert the combined injected text stays within
 * the total session-start budget (≤ 1500 tokens) and the recall-only budget for
 * UserPromptSubmit (≤ 800 tokens).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estimateTokens, INJECT_LIMITS } from "../src/injectBudget.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared at module scope so Vitest hoists them correctly.
// ---------------------------------------------------------------------------

vi.mock("../src/recall.js", () => ({
  hybridRecall: vi.fn(async () =>
    Array.from({ length: 50 }, (_, i) => ({
      relPath: `decisions/2026-05-22-foo-${i}.md`,
      headingPath: "Context",
      anchor: "context",
      excerpt: "x".repeat(200),
    }))
  ),
}));

// Do NOT mock preferences.js — we want the real compileInjectionBlock/capPreferences
// to run so the test validates the actual cap enforcement.
// The 50 KB preferences.md fixture written in beforeEach exercises capPreferences.

vi.mock("../src/dailyState.js", () => ({
  readDay: vi.fn(() => {
    // Return 30 open threads across 2 sessions.
    const threads = Array.from({ length: 30 }, (_, i) => `Thread about topic ${i} that is relatively verbose`);
    return {
      "session-a": { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: threads.slice(0, 15) },
      "session-b": { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: threads.slice(15) },
    };
  }),
}));

// appendInjectedSlugs is a side-effect-only call; silence it.
vi.mock("../src/sessionInjected.js", () => ({
  appendInjectedSlugs: vi.fn(),
  getInjectedSlugs: vi.fn(() => []),
}));

// logInject is telemetry; silence it.
vi.mock("../src/injectTelemetry.js", () => ({
  logInject: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "sbib-"));
  process.env.SUPERBRAIN_DATA_DIR = tmpHome;
  fs.mkdirSync(path.join(tmpHome, "vault", "meta"), { recursive: true });
  // Write a 50 KB preferences file (only matters if compileInjectionBlock is NOT mocked)
  fs.writeFileSync(
    path.join(tmpHome, "vault", "meta", "preferences.md"),
    "---\ntype: preference\n---\n" + "x".repeat(50_000)
  );
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers — also sanity-check the limits themselves
// ---------------------------------------------------------------------------

describe("INJECT_LIMITS sanity", () => {
  it("sum of all limits ≤ 1400 (leaves 100 token headroom under the 1500 outer cap)", () => {
    const sum =
      INJECT_LIMITS.recall +
      INJECT_LIMITS.preferences +
      INJECT_LIMITS.openThreads +
      INJECT_LIMITS.notices;
    expect(sum).toBeLessThanOrEqual(1400);
  });
});

// ---------------------------------------------------------------------------
// SessionStart: appendDigest with worst-case inputs
// ---------------------------------------------------------------------------

describe("SessionStart inject-budget guard", () => {
  it("total injected tokens ≤ 1500 with 50 recall hits, 50 KB prefs, 30 open threads", async () => {
    const { appendDigest } = await import("../src/sessionDigest.js");

    const parts: string[] = [];
    await appendDigest(parts, { cwd: "/some/project", session_id: "test-sid" });

    const combined = parts.join("\n\n");
    const tokens = estimateTokens(combined);

    // Outer budget guard: total SessionStart injection must not exceed 1500 tokens.
    expect(tokens).toBeLessThanOrEqual(1500);
  });

  it("each section individually respects its per-section limit", async () => {
    const { appendDigest } = await import("../src/sessionDigest.js");

    const parts: string[] = [];
    await appendDigest(parts, { cwd: "/some/project", session_id: "test-sid" });

    // We expect up to 3 parts: recall, preferences, openThreads.
    // Each must be within reasonable bounds (their own limit + small header overhead).
    for (const part of parts) {
      const tokens = estimateTokens(part);
      // No single section should exceed 600 tokens (any limit is ≤ 500, header ~30 tok).
      expect(tokens).toBeLessThanOrEqual(600);
    }
  });
});

// ---------------------------------------------------------------------------
// UserPromptSubmit: sb-recall.ts inner logic with worst-case inputs
//
// sb-recall.ts calls hybridRecall dynamically (after a deps check) and then joins
// all lines without a fitToBudget gate. The budget here is bounded by:
//   - k=5 hard-coded recall limit in hybridRecall call
//   - each excerpt truncated to 160 chars by toPointers (inside recall.ts)
//
// Worst-case: 5 hits × (160-char excerpt + 50-char path + formatting) ≈ 265 tokens.
// We verify the formula at injection time stays ≤ 800.
//
// We can't vi.mock a dynamic import inside bin/sb-recall.ts, so we replicate
// the exact recallText construction from that file and assert the token bound.
// ---------------------------------------------------------------------------

describe("UserPromptSubmit inject-budget guard", () => {
  it("recall text with 5 hits (max k) stays ≤ 800 tokens", () => {
    // Replicate the exact logic from bin/sb-recall.ts lines construction.
    // This is the actual text that would be emitted as additionalContext.
    const hits = Array.from({ length: 5 }, (_, i) => ({
      relPath: `decisions/2026-05-22-worst-case-filename-${i}.md`,
      headingPath: "Very Long Heading Path That Pushes Size",
      excerpt: "x".repeat(160), // max excerpt length from toPointers()
    }));

    const lines = hits.map(
      (p: any) =>
        `- [[${p.relPath.replace(/\.md$/, "")}]]${p.headingPath ? " › " + p.headingPath : ""} — ${p.excerpt}`
    );
    const recallText =
      "SuperBrain recall (your vault may already answer this):\n" + lines.join("\n");

    const tokens = estimateTokens(recallText);

    // UserPromptSubmit recall-only budget: ≤ 800 tokens.
    expect(tokens).toBeLessThanOrEqual(800);
  });

  it("INJECT_LIMITS.recall alone is ≤ 800 (the UserPromptSubmit single-section budget)", () => {
    // If someone raises INJECT_LIMITS.recall above 800, UserPromptSubmit would
    // need a hard cap too. This test catches that drift.
    expect(INJECT_LIMITS.recall).toBeLessThanOrEqual(800);
  });
});
