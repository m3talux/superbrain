import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  planReattribution,
  applyReattribution,
  type ReattributionPlan,
} from "../src/reattributeFromHistory.js";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-reattr-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-reattr-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function writeSession(sid: string, cwd: string): void {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  const event = { type: "tool", tool: "Write", file: "a.ts", cwd, ts: "2026-05-28T10:00:00.000Z" };
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions", `${sid}.ndjson`),
    JSON.stringify(event) + "\n",
  );
}

function writeDaily(date: string, entries: Record<string, { routedRelPaths: string[] }>): void {
  fs.mkdirSync(path.join(TMP_DATA, "daily"), { recursive: true });
  const state: Record<string, any> = {};
  for (const [sid, entry] of Object.entries(entries)) {
    state[sid] = { digestLine: "", alsoDid: [], openThreads: [], ...entry };
  }
  fs.writeFileSync(path.join(TMP_DATA, "daily", `${date}.json`), JSON.stringify(state));
}

function writeVaultNote(relPath: string, frontmatterLines: string, body = "some body\n"): void {
  const abs = path.join(TMP_VAULT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\n${frontmatterLines}\n---\n\n${body}`);
}

function readVaultNote(relPath: string): string {
  return fs.readFileSync(path.join(TMP_VAULT, relPath), "utf8");
}

describe("planReattribution", () => {
  it("fixes a note whose project is MISSING when history maps it to a valid cwd", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-fix-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "my-app" }));
      const expectedSlug = path.basename(repoDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      writeSession("S1", repoDir);
      const noteRel = "capture/2026-05-28-some-note.md";
      writeDaily("2026-05-28", { S1: { routedRelPaths: [noteRel] } });
      writeVaultNote(noteRel, "type: capture\nstatus: active");

      process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
      process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
      process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
      try {
        const plan = planReattribution(TMP_DATA);
        const fix = plan.fixes.find(f => f.relPath === noteRel);
        expect(fix).toBeDefined();
        expect(fix!.newProject).toBe(expectedSlug);
      } finally {
        delete process.env.SUPERBRAIN_DATA_DIR;
        delete process.env.SUPERBRAIN_VAULT_DIR;
        delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
      }
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("fixes a note whose project is JUNK (contains /)", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-junk-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "my-app" }));
      const expectedSlug = path.basename(repoDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      writeSession("S2", repoDir);
      const noteRel = "capture/2026-05-28-junk-note.md";
      writeDaily("2026-05-28", { S2: { routedRelPaths: [noteRel] } });
      writeVaultNote(noteRel, "type: capture\nstatus: active\nproject: /bad/path");

      process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
      process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
      process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
      try {
        const plan = planReattribution(TMP_DATA);
        const fix = plan.fixes.find(f => f.relPath === noteRel);
        expect(fix).toBeDefined();
        expect(fix!.newProject).toBe(expectedSlug);
      } finally {
        delete process.env.SUPERBRAIN_DATA_DIR;
        delete process.env.SUPERBRAIN_VAULT_DIR;
        delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
      }
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("fixes a note whose project is JUNK (contains ,)", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-comma-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "my-app" }));
      const expectedSlug = path.basename(repoDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      writeSession("S3", repoDir);
      const noteRel = "capture/2026-05-28-comma-note.md";
      writeDaily("2026-05-28", { S3: { routedRelPaths: [noteRel] } });
      writeVaultNote(noteRel, "type: capture\nstatus: active\nproject: foo,bar");

      process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
      process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
      process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
      try {
        const plan = planReattribution(TMP_DATA);
        const fix = plan.fixes.find(f => f.relPath === noteRel);
        expect(fix).toBeDefined();
        expect(fix!.newProject).toBe(expectedSlug);
      } finally {
        delete process.env.SUPERBRAIN_DATA_DIR;
        delete process.env.SUPERBRAIN_VAULT_DIR;
        delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
      }
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("fixes a note whose project contains uppercase (not a valid slug)", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-stray-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "my-app" }));
      const expectedSlug = path.basename(repoDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      writeSession("S4", repoDir);
      const noteRel = "capture/2026-05-28-stray-note.md";
      writeDaily("2026-05-28", { S4: { routedRelPaths: [noteRel] } });
      writeVaultNote(noteRel, "type: capture\nstatus: active\nproject: MyBadProject");

      process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
      process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
      process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
      try {
        const plan = planReattribution(TMP_DATA);
        const fix = plan.fixes.find(f => f.relPath === noteRel);
        expect(fix).toBeDefined();
        expect(fix!.newProject).toBe(expectedSlug);
      } finally {
        delete process.env.SUPERBRAIN_DATA_DIR;
        delete process.env.SUPERBRAIN_VAULT_DIR;
        delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
      }
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("leaves a note with a valid project (global) untouched", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-valid-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "my-app" }));

      writeSession("S5", repoDir);
      const noteRel = "capture/2026-05-28-valid-note.md";
      writeDaily("2026-05-28", { S5: { routedRelPaths: [noteRel] } });
      writeVaultNote(noteRel, "type: capture\nstatus: active\nproject: global");

      process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
      process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
      process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
      try {
        const plan = planReattribution(TMP_DATA);
        const fix = plan.fixes.find(f => f.relPath === noteRel);
        expect(fix).toBeUndefined();
      } finally {
        delete process.env.SUPERBRAIN_DATA_DIR;
        delete process.env.SUPERBRAIN_VAULT_DIR;
        delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
      }
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("leaves a note with an existing projects/<slug>.md untouched", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-existing-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "my-app" }));

      writeSession("S6", repoDir);
      const noteRel = "capture/2026-05-28-known-project-note.md";
      writeDaily("2026-05-28", { S6: { routedRelPaths: [noteRel] } });
      writeVaultNote(noteRel, "type: capture\nstatus: active\nproject: real-project");
      writeVaultNote("projects/real-project.md", "type: project\nstatus: active\nproject: real-project");

      process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
      process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
      process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
      try {
        const plan = planReattribution(TMP_DATA);
        const fix = plan.fixes.find(f => f.relPath === noteRel);
        expect(fix).toBeUndefined();
      } finally {
        delete process.env.SUPERBRAIN_DATA_DIR;
        delete process.env.SUPERBRAIN_VAULT_DIR;
        delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
      }
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("applyReattribution", () => {
  it("rewrites frontmatter project field for a note with missing project", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-apply-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "my-app" }));
      const expectedSlug = path.basename(repoDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      writeSession("SA", repoDir);
      const noteRel = "capture/2026-05-28-apply-note.md";
      writeDaily("2026-05-28", { SA: { routedRelPaths: [noteRel] } });
      writeVaultNote(noteRel, "type: capture\nstatus: active");

      process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
      process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
      process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
      try {
        const plan = planReattribution(TMP_DATA);
        applyReattribution(plan);

        const content = readVaultNote(noteRel);
        expect(content).toMatch(new RegExp(`^project: ${expectedSlug}$`, "m"));
      } finally {
        delete process.env.SUPERBRAIN_DATA_DIR;
        delete process.env.SUPERBRAIN_VAULT_DIR;
        delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
      }
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("is idempotent: second run produces no new fixes", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-idem-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "my-app" }));
      const expectedSlug = path.basename(repoDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      writeSession("SI", repoDir);
      const noteRel = "capture/2026-05-28-idem-note.md";
      writeDaily("2026-05-28", { SI: { routedRelPaths: [noteRel] } });
      writeVaultNote(noteRel, "type: capture\nstatus: active");

      process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
      process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
      process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
      try {
        const plan1 = planReattribution(TMP_DATA);
        expect(plan1.fixes.length).toBeGreaterThan(0);
        applyReattribution(plan1);

        const content1 = readVaultNote(noteRel);
        expect(content1).toMatch(new RegExp(`^project: ${expectedSlug}$`, "m"));

        const plan2 = planReattribution(TMP_DATA);
        const fix = plan2.fixes.find(f => f.relPath === noteRel);
        expect(fix).toBeUndefined();
      } finally {
        delete process.env.SUPERBRAIN_DATA_DIR;
        delete process.env.SUPERBRAIN_VAULT_DIR;
        delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
      }
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("does not touch notes with valid project", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-notouch-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "my-app" }));

      writeSession("SV", repoDir);
      const noteRel = "capture/2026-05-28-valid-proj.md";
      const originalContent = `---\ntype: capture\nstatus: active\nproject: global\n---\n\nsome body\n`;
      const abs = path.join(TMP_VAULT, noteRel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, originalContent);
      writeDaily("2026-05-28", { SV: { routedRelPaths: [noteRel] } });

      process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
      process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
      process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
      try {
        const plan = planReattribution(TMP_DATA);
        applyReattribution(plan);

        const content = readVaultNote(noteRel);
        expect(content).toBe(originalContent);
      } finally {
        delete process.env.SUPERBRAIN_DATA_DIR;
        delete process.env.SUPERBRAIN_VAULT_DIR;
        delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
      }
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
