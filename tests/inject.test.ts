import { describe, it, expect } from "vitest";
import { sanityCheck, detectMode } from "../src/injectRun.js";

describe("sanityCheck", () => {
  it("rejects empty string", () => {
    expect(sanityCheck("")).toEqual({ ok: false, code: 2, reason: "empty input" });
  });
  it("rejects whitespace-only", () => {
    expect(sanityCheck("   \n\t\n  ")).toEqual({ ok: false, code: 2, reason: "empty input" });
  });
  it("rejects pure punctuation", () => {
    expect(sanityCheck("!!!")).toEqual({ ok: false, code: 2, reason: "no alphanumeric content" });
  });
  it("rejects single emoji", () => {
    expect(sanityCheck("🎉")).toEqual({ ok: false, code: 2, reason: "no alphanumeric content" });
  });
  it("rejects input over 32 KB", () => {
    const big = "a".repeat(32 * 1024 + 1);
    expect(sanityCheck(big)).toEqual({ ok: false, code: 2, reason: "input exceeds 32 KB" });
  });
  it("strips null bytes and accepts the remainder if non-empty", () => {
    const r = sanityCheck("hello\0\0 world");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("hello world");
  });
  it("rejects after null-byte strip if empty", () => {
    expect(sanityCheck("\0\0 \0 ").ok).toBe(false);
  });
  it("accepts normal short text", () => {
    const r = sanityCheck("hello world");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("hello world");
  });
});

describe("detectMode", () => {
  it("picks verbatim for short single-blob input", () => {
    expect(detectMode("a short thought", {})).toBe("verbatim");
  });
  it("picks distill for input over 200 chars", () => {
    expect(detectMode("a".repeat(201), {})).toBe("distill");
  });
  it("picks distill when input contains a blank-line separator", () => {
    expect(detectMode("para one\n\npara two", {})).toBe("distill");
  });
  it("respects explicit --verbatim flag even on long input", () => {
    expect(detectMode("a".repeat(500), { verbatim: true })).toBe("verbatim");
  });
  it("respects explicit --distill flag even on short input", () => {
    expect(detectMode("hi", { distill: true })).toBe("distill");
  });
});

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeTmpEnv(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sb-inject-${name}-`));
  const dataDir = path.join(root, "data");
  const vaultDir = path.join(root, "vault");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  return { root, dataDir, vaultDir };
}

describe("runInject — verbatim mode", () => {
  it("writes a capture note with inject provenance and updates daily note", async () => {
    const { dataDir, vaultDir } = makeTmpEnv("verbatim");
    process.env.SUPERBRAIN_DATA_DIR = dataDir;
    process.env.SUPERBRAIN_VAULT_DIR = vaultDir;
    process.env.SUPERBRAIN_EMBED_STUB = "1";

    const { runInject } = await import("../src/injectRun.js");
    const result = await runInject("a brief side thought about wcloud", { verbatim: true });

    expect(result.ok).toBe(true);
    expect(result.notes).toHaveLength(1);
    const captureRel = result.notes[0];
    expect(captureRel).toMatch(/^capture\/\d{4}-\d{2}-\d{2}-/);
    const captureBody = fs.readFileSync(path.join(vaultDir, captureRel), "utf8");
    expect(captureBody).toMatch(/source: inject/);
    expect(captureBody).toMatch(/inject_mode: verbatim/);
    expect(captureBody).toMatch(/<!-- superbrain:inject /);
    expect(captureBody).toMatch(/a brief side thought about wcloud/);

    const today = new Date().toISOString().slice(0, 10);
    const dailyRel = `daily/${today}.md`;
    expect(fs.existsSync(path.join(vaultDir, dailyRel))).toBe(true);

    const injectLog = path.join(dataDir, "inject.log");
    expect(fs.existsSync(injectLog)).toBe(true);
    expect(fs.readFileSync(injectLog, "utf8")).toMatch(/verbatim \| 1 notes/);
  });
});
