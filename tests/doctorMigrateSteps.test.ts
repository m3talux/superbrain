import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const doctorSrc = path.resolve("bin/sb-doctor.ts");

function makeFakeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-migrate-steps-"));
  fs.mkdirSync(path.join(dir, "decisions"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "decisions", "test.md"),
    "---\ntype: decision\nproject: global\n---\n\nbody\n",
  );
  return dir;
}

function runDoctor(vault: string): ReturnType<typeof spawnSync> {
  return spawnSync("npx", ["tsx", doctorSrc, "migrate-all"], {
    input: "N\n",
    encoding: "utf8",
    env: { ...process.env, SUPERBRAIN_VAULT_DIR: vault, SUPERBRAIN_FAKE_MIGRATE: "1" },
    timeout: 30000,
  });
}

describe("sb-doctor migrate-all MIGRATION_STEPS wiring", () => {
  it("includes cleanup-daily-mirrors in the step list", () => {
    const vault = makeFakeVault();
    try {
      const r = runDoctor(vault);
      expect(r.stdout).toMatch(/cleanup-daily-mirrors/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it("includes recover-lessons in the step list", () => {
    const vault = makeFakeVault();
    try {
      const r = runDoctor(vault);
      expect(r.stdout).toMatch(/recover-lessons/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it("includes reattribute-from-history in the step list", () => {
    const vault = makeFakeVault();
    try {
      const r = runDoctor(vault);
      expect(r.stdout).toMatch(/reattribute-from-history/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it("reattribute-from-history step appears before recover-lessons (order check)", () => {
    const vault = makeFakeVault();
    try {
      const r = runDoctor(vault);
      const reattributionIdx = r.stdout.indexOf("reattribute-from-history");
      const recoverIdx = r.stdout.indexOf("recover-lessons");
      expect(reattributionIdx).toBeGreaterThan(-1);
      expect(recoverIdx).toBeGreaterThan(-1);
      expect(reattributionIdx).toBeLessThan(recoverIdx);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
