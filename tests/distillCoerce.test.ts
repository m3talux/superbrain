import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-coerce-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-coerce-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("a freeform capture that fails the strict rubric is coerced and written, not only rejected", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions/C.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );

  const stub = path.join(TMP_DATA, "stub.json");
  // Freeform capture: no ## What / ## Why it matters sections, title > 8 words.
  // This violates two rubric rules and must be coerced, not dropped.
  fs.writeFileSync(stub, JSON.stringify([
    {
      kind: "capture",
      title: "This is a very long capture title that exceeds the eight word limit badly.",
      date: "2026-05-22",
      body: "We observed that the new BM25 hybrid retrieval significantly outperformed the old approach in all our benchmarks. The improvement was especially pronounced for multi-word queries. This is worth keeping as a reference point for future architecture decisions.",
      links: [],
    },
  ]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/C.prompt.json"), "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "C",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });

  // The coerced note must be written somewhere under capture/.
  const captureDir = path.join(TMP_VAULT, "capture");
  expect(fs.existsSync(captureDir)).toBe(true);
  const files = fs.readdirSync(captureDir).filter((f) => f.endsWith(".md"));
  expect(files.length).toBeGreaterThan(0);

  // The coerced note must contain ## What and ## Why it matters sections.
  const noteContent = fs.readFileSync(path.join(captureDir, files[0]), "utf8");
  expect(noteContent).toMatch(/## What/);
  expect(noteContent).toMatch(/## Why it matters/);

  // The cursor must have advanced (run did not abort).
  expect(Number(fs.readFileSync(path.join(TMP_DATA, "sessions/C.cursor"), "utf8"))).toBeGreaterThan(0);
});

it("a lesson with no project field is written to vault (cross-project by design)", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions/L.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );

  const stub = path.join(TMP_DATA, "stub.json");
  // Lesson without a project field — cross-project lessons are valid.
  fs.writeFileSync(stub, JSON.stringify([
    {
      kind: "lesson",
      title: "Verify live data dir before diagnosing",
      date: "2026-05-22",
      rule: "Resolve the actual data path before inspecting on-disk state.",
      why: "On 2026-05-20 a full misdiagnosis was produced because the source fallback was inspected instead of the live path.",
      whenApplies: "Any time a plugin appears to not be writing data.",
      links: [],
    },
  ]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/L.prompt.json"), "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "L",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });

  const lessonsDir = path.join(TMP_VAULT, "lessons");
  expect(fs.existsSync(lessonsDir)).toBe(true);
  const files = fs.readdirSync(lessonsDir).filter((f) => f.endsWith(".md"));
  expect(files.length).toBeGreaterThan(0);

  expect(Number(fs.readFileSync(path.join(TMP_DATA, "sessions/L.cursor"), "utf8"))).toBeGreaterThan(0);
});

it("a decision whose title triggers the lesson reroute is coerced to a lesson, with type: lesson frontmatter", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions/LC.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );

  const stub = path.join(TMP_DATA, "stub.json");
  // Title first word "Always" is in REROUTE_TO_LESSON, so classify reroutes this
  // decision to a lesson; the written note must carry lesson frontmatter, not decision.
  fs.writeFileSync(stub, JSON.stringify([
    {
      kind: "decision",
      title: "Always resolve the live data dir before diagnosing",
      date: "2026-05-22",
      body: "We kept misdiagnosing because we trusted the fallback path. Resolve the real data dir first.",
      links: [],
    },
  ]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/LC.prompt.json"), "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "LC",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });

  const lessonsDir = path.join(TMP_VAULT, "lessons");
  expect(fs.existsSync(lessonsDir)).toBe(true);
  const files = fs.readdirSync(lessonsDir).filter((f) => f.endsWith(".md"));
  expect(files.length).toBeGreaterThan(0);
  const content = fs.readFileSync(path.join(lessonsDir, files[0]), "utf8");
  expect(content).toMatch(/^type: lesson$/m);
  expect(content).not.toMatch(/^type: decision$/m);
  expect(fs.existsSync(path.join(TMP_VAULT, "decisions"))).toBe(false);

  expect(Number(fs.readFileSync(path.join(TMP_DATA, "sessions/LC.cursor"), "utf8"))).toBeGreaterThan(0);
});

it("a structured note rejected with no reroute suggestion is triaged to capture, not written malformed in place", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions/FT.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );

  const stub = path.join(TMP_DATA, "stub.json");
  // A decision with no reroute-prefix title and a body missing every required
  // decision section: classify rejects it with no suggestedType, so it falls
  // through. It must triage into capture/, never be written as a malformed decision.
  fs.writeFileSync(stub, JSON.stringify([
    {
      kind: "decision",
      title: "Use Postgres for the job queue",
      date: "2026-05-22",
      body: "We will use Postgres.",
      links: [],
    },
  ]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/FT.prompt.json"), "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "FT",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });

  const captureDir = path.join(TMP_VAULT, "capture");
  expect(fs.existsSync(captureDir)).toBe(true);
  const files = fs.readdirSync(captureDir).filter((f) => f.endsWith(".md"));
  expect(files.length).toBeGreaterThan(0);
  const content = fs.readFileSync(path.join(captureDir, files[0]), "utf8");
  expect(content).toMatch(/^type: capture$/m);
  expect(fs.existsSync(path.join(TMP_VAULT, "decisions"))).toBe(false);

  const rejectsFile = path.join(TMP_VAULT, "meta", "distill-rejects.md");
  expect(fs.existsSync(rejectsFile)).toBe(true);
  expect(fs.readFileSync(rejectsFile, "utf8")).toMatch(/coerced/i);

  expect(Number(fs.readFileSync(path.join(TMP_DATA, "sessions/FT.cursor"), "utf8"))).toBeGreaterThan(0);
});
