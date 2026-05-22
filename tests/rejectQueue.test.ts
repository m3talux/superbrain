import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordRejection } from "../src/rejectQueue.js";

describe("rejectQueue", () => {
  let vaultDir: string;
  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbrq-"));
  });

  it("appends a structured rejection block", () => {
    recordRejection(vaultDir, {
      type: "decision", reason: "missing Alternatives considered", sessionId: "sid-1",
      title: "Use BM25", excerpt: "some body excerpt"
    });
    const text = fs.readFileSync(path.join(vaultDir, "meta", "distill-rejects.md"), "utf8");
    expect(text).toMatch(/proposed decision rejected/);
    expect(text).toContain("**Reason:** missing Alternatives considered");
    expect(text).toContain("**Session:** sid-1");
    expect(text).toContain("**Proposed title:** Use BM25");
    expect(text).toContain("**Body excerpt:** some body excerpt");
  });

  it("creates meta/ directory if absent", () => {
    recordRejection(vaultDir, { type: "lesson", reason: "x", sessionId: "s", title: "t", excerpt: "e" });
    expect(fs.existsSync(path.join(vaultDir, "meta"))).toBe(true);
    expect(fs.existsSync(path.join(vaultDir, "meta", "distill-rejects.md"))).toBe(true);
  });

  it("accumulates multiple rejections", () => {
    recordRejection(vaultDir, { type: "decision", reason: "r1", sessionId: "s1", title: "t1", excerpt: "e1" });
    recordRejection(vaultDir, { type: "lesson", reason: "r2", sessionId: "s2", title: "t2", excerpt: "e2" });
    const text = fs.readFileSync(path.join(vaultDir, "meta", "distill-rejects.md"), "utf8");
    const blocks = text.match(/^## /gm) || [];
    expect(blocks.length).toBe(2);
    expect(text).toContain("**Reason:** r1");
    expect(text).toContain("**Reason:** r2");
  });

  it("slices excerpt to 200 characters", () => {
    const long = "x".repeat(500);
    recordRejection(vaultDir, { type: "capture", reason: "r", sessionId: "s", title: "t", excerpt: long });
    const text = fs.readFileSync(path.join(vaultDir, "meta", "distill-rejects.md"), "utf8");
    // The body excerpt line contains exactly 200 x's
    expect(text).toMatch(/\*\*Body excerpt:\*\* x{200}\n/);
    expect(text).not.toMatch(/\*\*Body excerpt:\*\* x{201}/);
  });

  it("includes ISO timestamp in the heading", () => {
    recordRejection(vaultDir, { type: "capture", reason: "r", sessionId: "s", title: "t", excerpt: "e" });
    const text = fs.readFileSync(path.join(vaultDir, "meta", "distill-rejects.md"), "utf8");
    expect(text).toMatch(/^\n## \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z — proposed capture rejected/m);
  });
});
