import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const doctorBin = path.resolve("dist/bin/sb-doctor.js");

// Fake vault with some notes so migrate-all has a vault path that exists.
function makeFakeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-migrate-vault-"));
  fs.mkdirSync(path.join(dir, "decisions"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "decisions", "test.md"),
    "---\ntype: decision\nproject: global\n---\n\nbody\n"
  );
  return dir;
}

describe("sb-doctor migrate-all", () => {
  it("shows dry-run output and exits 0 when user types N", () => {
    const vault = makeFakeVault();
    try {
      const r = spawnSync("node", [doctorBin, "migrate-all"], {
        input: "N\n",
        encoding: "utf8",
        env: {
          ...process.env,
          SUPERBRAIN_VAULT_DIR: vault,
          SUPERBRAIN_FAKE_MIGRATE: "1",
        },
        timeout: 30000,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/SuperBrain migrate-all/);
      expect(r.stdout).toMatch(/Vault:/);
      expect(r.stdout).toMatch(/Step 1\/4: backfill-frontmatter/);
      expect(r.stdout).toMatch(/Step 2\/4: retro-collapse-duplicates/);
      expect(r.stdout).toMatch(/Step 3\/4: migrate-vault/);
      expect(r.stdout).toMatch(/Step 4\/4: retro-prune-preferences/);
      expect(r.stdout).toMatch(/Apply all 4 steps\? \[y\/N\]/);
      expect(r.stdout).toMatch(/Aborted/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it("applies all steps and exits 0 when user types y (fake mode)", () => {
    const vault = makeFakeVault();
    try {
      const r = spawnSync("node", [doctorBin, "migrate-all"], {
        input: "y\n",
        encoding: "utf8",
        env: {
          ...process.env,
          SUPERBRAIN_VAULT_DIR: vault,
          SUPERBRAIN_FAKE_MIGRATE: "1",
        },
        timeout: 30000,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/Applying/);
      expect(r.stdout).toMatch(/Step 1\/4: backfill-frontmatter --apply/);
      expect(r.stdout).toMatch(/\[fake\] applied/);
      expect(r.stdout).toMatch(/migrate-all complete/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it("exits 0 when user presses enter (defaults to N)", () => {
    const vault = makeFakeVault();
    try {
      const r = spawnSync("node", [doctorBin, "migrate-all"], {
        input: "\n",
        encoding: "utf8",
        env: {
          ...process.env,
          SUPERBRAIN_VAULT_DIR: vault,
          SUPERBRAIN_FAKE_MIGRATE: "1",
        },
        timeout: 30000,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/Aborted/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it("help updated to include migrate-all", () => {
    const r = spawnSync("node", [doctorBin, "--help"], { encoding: "utf8" });
    expect(r.stdout).toMatch(/migrate-all/);
  });
});
