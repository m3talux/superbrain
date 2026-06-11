// tests/sessionNote.test.ts
import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendPromptLine,
  appendAssistantTail,
  updateSessionNoteDigest,
  notePointerPath,
} from "../src/sessionNote.js";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sn-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sn-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
});
afterEach(() => {
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_VAULT_DIR;
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function noteAbs(sid: string): string {
  const rel = fs.readFileSync(notePointerPath(sid), "utf8").trim();
  return path.join(TMP_VAULT, rel);
}

it("first prompt line creates the note with frontmatter and pointer", () => {
  appendPromptLine("S1234567890", "/tmp/nowhere", "hello world");
  const abs = noteAbs("S1234567890");
  const raw = fs.readFileSync(abs, "utf8");
  expect(path.basename(abs)).toMatch(/^unscoped-\d+\.md$/);
  expect(raw).toContain("type: session");
  expect(raw).toContain("session: S1234567890");
  expect(raw).toContain("## Digest");
  expect(raw).toContain("(no checkpoint yet)");
  expect(raw).toContain("## Turn log");
  expect(raw).toMatch(/- \d{2}:\d{2} ▸ hello world\n$/);
});

it("assistant tail appends an indented continuation line", () => {
  appendPromptLine("S2", "/tmp/nowhere", "question");
  appendAssistantTail("S2", "/tmp/nowhere", "the  answer\nwith newlines");
  const raw = fs.readFileSync(noteAbs("S2"), "utf8");
  expect(raw).toContain("  ↳ the answer with newlines");
});

it("long lines are truncated to a single ~200-char line", () => {
  appendPromptLine("S3", "/tmp/nowhere", "x".repeat(500));
  const raw = fs.readFileSync(noteAbs("S3"), "utf8");
  const line = raw.split("\n").find((l) => l.includes("▸"))!;
  expect(line.length).toBeLessThan(220);
  expect(line).toContain("…");
});

it("digest update replaces placeholder and appends deduped routed links", () => {
  appendPromptLine("S4", "/tmp/nowhere", "work");
  updateSessionNoteDigest("S4", "Fixed the frobnicator", ["decisions/2026-06-11-a.md", "lessons/b.md"]);
  let raw = fs.readFileSync(noteAbs("S4"), "utf8");
  expect(raw).toContain("## Digest\n\nFixed the frobnicator");
  expect(raw).not.toContain("(no checkpoint yet)");
  expect(raw).toContain("- [[decisions/2026-06-11-a]]");
  expect(raw).toContain("- [[lessons/b]]");
  updateSessionNoteDigest("S4", "Fixed and tested the frobnicator", ["decisions/2026-06-11-a.md"]);
  raw = fs.readFileSync(noteAbs("S4"), "utf8");
  expect(raw).toContain("## Digest\n\nFixed and tested the frobnicator");
  expect(raw.match(/2026-06-11-a/g)!.length).toBe(1);
});

it("digest update for a session with no note is a no-op", () => {
  expect(() => updateSessionNoteDigest("GHOST", "digest", [])).not.toThrow();
});

it("turn log trims oldest lines past the size cap, digest survives", () => {
  appendPromptLine("S5", "/tmp/nowhere", "first-marker");
  updateSessionNoteDigest("S5", "the digest", []);
  for (let i = 0; i < 400; i++) {
    appendPromptLine("S5", "/tmp/nowhere", `prompt ${i} ${"y".repeat(180)}`);
  }
  const raw = fs.readFileSync(noteAbs("S5"), "utf8");
  expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(64 * 1024 + 512);
  expect(raw).toContain("the digest");
  expect(raw).not.toContain("first-marker");
  expect(raw).toContain("prompt 399");
});

it("recreates the note if pointer exists but file was removed", () => {
  appendPromptLine("S6", "/tmp/nowhere", "before");
  fs.rmSync(noteAbs("S6"));
  appendPromptLine("S6", "/tmp/nowhere", "after");
  const raw = fs.readFileSync(noteAbs("S6"), "utf8");
  expect(raw).toContain("type: session");
  expect(raw).toContain("after");
});
