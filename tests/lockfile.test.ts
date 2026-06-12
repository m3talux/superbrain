import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, releaseLock } from "../src/lockfile";
import { deadPid } from "./helpers/subprocess";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-lock-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("lockfile", () => {
  it("grants then blocks then re-grants after release", () => {
    expect(acquireLock("distill")).toBe(true);
    expect(acquireLock("distill")).toBe(false);
    releaseLock("distill");
    expect(acquireLock("distill")).toBe(true);
  });
  it("breaks a stale lock older than maxAgeMs", () => {
    expect(acquireLock("distill")).toBe(true);
    expect(acquireLock("distill", { maxAgeMs: -1 })).toBe(true); // any age is stale
  });
  it("releaseLock refuses a foreign holder", () => {
    expect(acquireLock("distill")).toBe(true);
    releaseLock("distill", "wrong-token");
    expect(acquireLock("distill")).toBe(false);
  });
  it("a release bearing the matching token frees the lock", () => {
    expect(acquireLock("distill")).toBe(true);
    const token = fs.readFileSync(path.join(TMP, "locks", "distill.lock", "token"), "utf8");
    releaseLock("distill", token);
    expect(acquireLock("distill")).toBe(true);
  });
  it("reclaims a fresh lock whose holder pid is dead, without waiting for the TTL", () => {
    expect(acquireLock("distill")).toBe(true);
    const pidFile = path.join(TMP, "locks", "distill.lock", "pid");
    fs.writeFileSync(pidFile, String(deadPid()));
    // age is ~0, far under the 15-min mtime TTL; only liveness can free it
    expect(acquireLock("distill")).toBe(true);
  });
  it("does NOT reclaim a fresh lock whose holder pid is alive", () => {
    expect(acquireLock("distill")).toBe(true);
    const pidFile = path.join(TMP, "locks", "distill.lock", "pid");
    fs.writeFileSync(pidFile, String(process.pid)); // this process is alive
    expect(acquireLock("distill")).toBe(false);
  });
  it("falls back to the mtime TTL when the pid is unreadable", () => {
    expect(acquireLock("distill")).toBe(true);
    const pidFile = path.join(TMP, "locks", "distill.lock", "pid");
    fs.rmSync(pidFile, { force: true });
    expect(acquireLock("distill")).toBe(false); // fresh, no pid -> hold
    expect(acquireLock("distill", { maxAgeMs: -1 })).toBe(true); // stale -> break
  });
});
