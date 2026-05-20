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
