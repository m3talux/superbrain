import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSessionProject } from "../src/distillRun.js";

beforeAll(() => { process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1"; });
afterAll(() => { delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST; });

describe("resolveSessionProject", () => {
  it("single-repo session: returns the dominant project slug from cwd", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rsp-single-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "test-proj" }));
      const events = [
        { type: "tool", tool: "Write", cwd: repoDir, ts: "t1" },
        { type: "tool", tool: "Write", cwd: repoDir, ts: "t2" },
        { type: "prompt", prompt: "do something", cwd: repoDir, ts: "t3" },
      ];
      const result = resolveSessionProject(events);
      const expectedSlug = path.basename(repoDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      expect(result.dominant).toBe(expectedSlug);
      expect(result.all).toContain(expectedSlug);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("non-project cwd (tmpdir / blocked): returns undefined dominant", () => {
    const events = [
      { type: "tool", tool: "Write", cwd: os.tmpdir(), ts: "t1" },
      { type: "prompt", prompt: "hello", cwd: os.tmpdir(), ts: "t2" },
    ];
    const result = resolveSessionProject(events);
    expect(result.dominant).toBeUndefined();
    expect(result.all).toHaveLength(0);
  });

  it("empty events: returns undefined dominant", () => {
    const result = resolveSessionProject([]);
    expect(result.dominant).toBeUndefined();
    expect(result.all).toHaveLength(0);
  });

  it("events without cwd: returns undefined dominant", () => {
    const result = resolveSessionProject([
      { type: "tool", tool: "Write", ts: "t1" },
      { type: "prompt", prompt: "hi", ts: "t2" },
    ]);
    expect(result.dominant).toBeUndefined();
    expect(result.all).toHaveLength(0);
  });

  it("multi-cwd session: dominant is the most-frequent project, all contains both", () => {
    const repoA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rsp-mA-"));
    const repoB = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rsp-mB-"));
    try {
      fs.writeFileSync(path.join(repoA, "package.json"), JSON.stringify({ name: "proj-a" }));
      fs.writeFileSync(path.join(repoB, "package.json"), JSON.stringify({ name: "proj-b" }));

      const slugA = path.basename(repoA).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      const slugB = path.basename(repoB).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      const events = [
        { type: "tool", tool: "Write", cwd: repoA, ts: "t1" },
        { type: "tool", tool: "Write", cwd: repoA, ts: "t2" },
        { type: "tool", tool: "Write", cwd: repoA, ts: "t3" },
        { type: "tool", tool: "Write", cwd: repoB, ts: "t4" },
        { type: "tool", tool: "Write", cwd: repoB, ts: "t5" },
      ];
      const result = resolveSessionProject(events);
      expect(result.dominant).toBe(slugA);
      expect(result.all).toContain(slugA);
      expect(result.all).toContain(slugB);
    } finally {
      fs.rmSync(repoA, { recursive: true, force: true });
      fs.rmSync(repoB, { recursive: true, force: true });
    }
  });

  it("mix of project and non-project cwds: non-project cwd contributes no project", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rsp-mix-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "real-proj" }));
      const expectedSlug = path.basename(repoDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      const events = [
        { type: "tool", tool: "Write", cwd: os.tmpdir(), ts: "t1" },
        { type: "tool", tool: "Write", cwd: repoDir, ts: "t2" },
        { type: "tool", tool: "Write", cwd: repoDir, ts: "t3" },
      ];
      const result = resolveSessionProject(events);
      expect(result.dominant).toBe(expectedSlug);
      expect(result.all).toHaveLength(1);
      expect(result.all[0]).toBe(expectedSlug);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
