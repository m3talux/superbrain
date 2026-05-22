import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

describe("sb-doctor", () => {
  it("prints disk usage table", () => {
    const r = spawnSync("node", [path.resolve("dist/bin/sb-doctor.js"), "disk"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/SuperBrain disk usage:/);
    expect(r.stdout).toMatch(/vault\s+\d/);
    expect(r.stdout).toMatch(/transcripts\s+\d/);
    expect(r.stdout).toMatch(/Total\s+\d/);
  });

  it("--help prints usage", () => {
    const r = spawnSync("node", [path.resolve("dist/bin/sb-doctor.js"), "--help"], { encoding: "utf8" });
    expect(r.stdout).toMatch(/usage: sb-doctor/);
  });

  it("unknown subcommand exits 2", () => {
    const r = spawnSync("node", [path.resolve("dist/bin/sb-doctor.js"), "nonsense"], { encoding: "utf8" });
    expect(r.status).toBe(2);
  });

  it("inject prints no-records message when log is empty", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbd-"));
    const r = spawnSync("node", [path.resolve("dist/bin/sb-doctor.js"), "inject"], {
      encoding: "utf8",
      env: { ...process.env, SUPERBRAIN_HOME: tmpDir },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Inject telemetry/);
    expect(r.stdout).toMatch(/no records yet/);
  });

  it("inject prints per-channel averages from log", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbd-"));
    const record = JSON.stringify({ ts: "2026-05-22T18:00:00Z", hook: "SessionStart", sid: "s1", tokens: { recall: 312, preferences: 287, openThreads: 54, notices: 0 }, total: 653 });
    fs.writeFileSync(path.join(tmpDir, "inject.log"), record + "\n");
    const r = spawnSync("node", [path.resolve("dist/bin/sb-doctor.js"), "inject"], {
      encoding: "utf8",
      env: { ...process.env, SUPERBRAIN_HOME: tmpDir },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/SessionStart/);
    expect(r.stdout).toMatch(/recall/);
    expect(r.stdout).toMatch(/653/);
  });
});
