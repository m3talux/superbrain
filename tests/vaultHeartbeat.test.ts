import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { heartbeatWarning, HEARTBEAT_STALE_MS, probeVaultGit } from "../src/vaultHeartbeat.js";

describe("heartbeatWarning", () => {
  const STALE = HEARTBEAT_STALE_MS + 1;
  const FRESH = 1_000;

  it("warns when the tree is dirty AND HEAD is stale", () => {
    const w = heartbeatWarning({ dirty: true, headAgeMs: STALE });
    expect(w).toBeTruthy();
    expect(w).toMatch(/SuperBrain/);
    expect(w).toMatch(/auto-commit/i);
  });

  it("is silent when the tree is clean (even if HEAD is stale)", () => {
    expect(heartbeatWarning({ dirty: false, headAgeMs: STALE })).toBeNull();
  });

  it("is silent when HEAD is fresh (even if the tree is dirty)", () => {
    expect(heartbeatWarning({ dirty: true, headAgeMs: FRESH })).toBeNull();
  });

  it("is silent when HEAD age is unknown (probe failed / no commits)", () => {
    expect(heartbeatWarning({ dirty: true, headAgeMs: null })).toBeNull();
  });

  it("honors an injected staleMs threshold", () => {
    expect(heartbeatWarning({ dirty: true, headAgeMs: 5_000 }, { staleMs: 1_000 })).toBeTruthy();
    expect(heartbeatWarning({ dirty: true, headAgeMs: 500 }, { staleMs: 1_000 })).toBeNull();
  });

  it("reports the staleness in whole minutes", () => {
    const w = heartbeatWarning({ dirty: true, headAgeMs: 90 * 60_000 }, { staleMs: 60_000 });
    expect(w).toContain("90m");
  });
});

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-hb-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  g("init", "-q");
  g("config", "user.email", "t@t.t");
  g("config", "user.name", "t");
  return dir;
}

describe("probeVaultGit", () => {
  it("reports clean + a small headAgeMs right after a commit", () => {
    const dir = initRepo();
    fs.writeFileSync(path.join(dir, "a.txt"), "1");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "c1"], { cwd: dir });
    const s = probeVaultGit(dir);
    expect(s.dirty).toBe(false);
    expect(s.headAgeMs).not.toBeNull();
    expect(s.headAgeMs!).toBeLessThan(60_000);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports dirty when there is an untracked file", () => {
    const dir = initRepo();
    fs.writeFileSync(path.join(dir, "a.txt"), "1");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "c1"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "b.txt"), "2");
    expect(probeVaultGit(dir).dirty).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns headAgeMs=null for a fresh repo with no commits", () => {
    const dir = initRepo();
    expect(probeVaultGit(dir).headAgeMs).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("never throws on a non-repo path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-hb-norepo-"));
    expect(() => probeVaultGit(dir)).not.toThrow();
    expect(probeVaultGit(dir)).toEqual({ dirty: false, headAgeMs: null });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
