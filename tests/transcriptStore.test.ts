import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotPath, snapshotTranscript, gcTranscript } from "../src/transcriptStore.js";

describe("transcriptStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbts-"));
  });

  it("snapshotPath returns one stable path per session id", () => {
    const a = snapshotPath(dir, "sid-1");
    const b = snapshotPath(dir, "sid-1");
    expect(a).toBe(b);
    expect(a.endsWith(path.sep + "sid-1.jsonl")).toBe(true);
  });

  it("snapshotTranscript overwrites instead of creating new files", () => {
    const src = path.join(dir, "live.jsonl");
    fs.writeFileSync(src, "a\n");
    snapshotTranscript(dir, "sid-1", src);
    fs.writeFileSync(src, "a\nb\n");
    snapshotTranscript(dir, "sid-1", src);
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl") && f.startsWith("sid-1"));
    expect(files).toEqual(["sid-1.jsonl"]);
    expect(fs.readFileSync(path.join(dir, "sid-1.jsonl"), "utf8")).toBe("a\nb\n");
  });

  it("gcTranscript removes the snapshot", () => {
    const src = path.join(dir, "live.jsonl");
    fs.writeFileSync(src, "x");
    snapshotTranscript(dir, "sid-2", src);
    expect(fs.existsSync(snapshotPath(dir, "sid-2"))).toBe(true);
    gcTranscript(dir, "sid-2");
    expect(fs.existsSync(snapshotPath(dir, "sid-2"))).toBe(false);
  });

  it("gcTranscript is a no-op when file is missing", () => {
    expect(() => gcTranscript(dir, "nonexistent")).not.toThrow();
  });

  it("snapshotTranscript creates the target directory if absent", () => {
    const nested = path.join(dir, "nested", "transcripts");
    const src = path.join(dir, "live.jsonl");
    fs.writeFileSync(src, "x");
    snapshotTranscript(nested, "sid-3", src);
    expect(fs.existsSync(path.join(nested, "sid-3.jsonl"))).toBe(true);
  });
});
