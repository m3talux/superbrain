import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

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
});
