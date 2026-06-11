import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pruneSessionFiles, pruneSessionNotes } from "../src/sessionGc.js";

let TMP: string;

function sessDir(base: string): string {
  return path.join(base, "sessions");
}

function makeSessionFile(dir: string, name: string, mtime: Date): void {
  const p = path.join(dir, name);
  fs.writeFileSync(p, "");
  fs.utimesSync(p, mtime, mtime);
}

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sbgc-"));
  fs.mkdirSync(sessDir(TMP), { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("pruneSessionFiles", () => {
  it("removes a session group whose most-recent mtime exceeds maxAgeDays", () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const sid = "session-abc-001";
    const sd = sessDir(TMP);
    makeSessionFile(sd, `${sid}.ndjson`, old);
    makeSessionFile(sd, `${sid}.injected.json`, old);
    makeSessionFile(sd, `${sid}.turns.json`, old);

    const result = pruneSessionFiles(TMP, { maxAgeDays: 30 });
    expect(result.deleted.length).toBe(3);
    expect(result.errors).toEqual([]);
    expect(fs.existsSync(path.join(sd, `${sid}.ndjson`))).toBe(false);
    expect(fs.existsSync(path.join(sd, `${sid}.injected.json`))).toBe(false);
  });

  it("does not touch a session group within maxAgeDays", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const sid = "session-fresh-001";
    const sd = sessDir(TMP);
    makeSessionFile(sd, `${sid}.ndjson`, recent);
    makeSessionFile(sd, `${sid}.injected.json`, recent);

    const result = pruneSessionFiles(TMP, { maxAgeDays: 30 });
    expect(result.deleted).toEqual([]);
    expect(fs.existsSync(path.join(sd, `${sid}.ndjson`))).toBe(true);
  });

  it("dryRun returns would-be deleted list without deleting", () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const sid = "session-dry-001";
    const sd = sessDir(TMP);
    makeSessionFile(sd, `${sid}.ndjson`, old);
    makeSessionFile(sd, `${sid}.cursor`, old);

    const result = pruneSessionFiles(TMP, { maxAgeDays: 30, dryRun: true });
    expect(result.deleted.length).toBe(2);
    expect(fs.existsSync(path.join(sd, `${sid}.ndjson`))).toBe(true);
    expect(fs.existsSync(path.join(sd, `${sid}.cursor`))).toBe(true);
  });

  it("does NOT delete a group when some files are within the window and some are old (all-or-nothing)", () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const sid = "session-mixed-001";
    const sd = sessDir(TMP);
    makeSessionFile(sd, `${sid}.ndjson`, old);
    makeSessionFile(sd, `${sid}.injected.json`, recent);

    const result = pruneSessionFiles(TMP, { maxAgeDays: 30 });
    expect(result.deleted).toEqual([]);
    expect(fs.existsSync(path.join(sd, `${sid}.ndjson`))).toBe(true);
  });

  it("does not touch files with unknown extensions", () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const sd = sessDir(TMP);
    makeSessionFile(sd, "session-unk-001.weird", old);
    makeSessionFile(sd, "session-unk-001.log", old);

    const result = pruneSessionFiles(TMP, { maxAgeDays: 30 });
    expect(result.deleted).toEqual([]);
    expect(fs.existsSync(path.join(sd, "session-unk-001.weird"))).toBe(true);
  });

  it("collects errors and does not throw when unlink fails", () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const sid = "session-err-001";
    const sd = sessDir(TMP);
    const fp = path.join(sd, `${sid}.ndjson`);
    // Create a directory at the file path so fs.unlinkSync throws EPERM/EISDIR.
    // Set its mtime to be old so the group is selected for deletion.
    fs.mkdirSync(fp);
    fs.utimesSync(fp, old, old);

    const result = pruneSessionFiles(TMP, { maxAgeDays: 30 });
    // The directory cannot be unlinked with fs.unlinkSync, so an error is collected.
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    // Clean up the directory we made
    fs.rmdirSync(fp);
  });

  it("returns empty result without throwing when sessions dir does not exist", () => {
    fs.rmdirSync(sessDir(TMP));
    const result = pruneSessionFiles(TMP, { maxAgeDays: 30 });
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("a fresh needs-distill flag keeps the session group from being pruned", () => {
    const sd = sessDir(TMP);
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    fs.writeFileSync(path.join(sd, "B.ndjson"), "x\n");
    fs.utimesSync(path.join(sd, "B.ndjson"), old, old);
    fs.writeFileSync(path.join(sd, "B.needs-distill"), "1");
    const res = pruneSessionFiles(TMP, { maxAgeDays: 30 });
    expect(res.deleted).toHaveLength(0);
    expect(fs.existsSync(path.join(sd, "B.ndjson"))).toBe(true);
    expect(fs.existsSync(path.join(sd, "B.needs-distill"))).toBe(true);
  });

  it("handles all known session extensions: .ndjson .cursor .pending .salience.json .injected.json .turns.json", () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const sid = "session-exts-001";
    const sd = sessDir(TMP);
    const exts = [".ndjson", ".cursor", ".pending", ".salience.json", ".injected.json", ".turns.json"];
    for (const ext of exts) {
      makeSessionFile(sd, `${sid}${ext}`, old);
    }

    const result = pruneSessionFiles(TMP, { maxAgeDays: 30 });
    expect(result.deleted.length).toBe(exts.length);
    for (const ext of exts) {
      expect(fs.existsSync(path.join(sd, `${sid}${ext}`))).toBe(false);
    }
  });

  it("a .note pointer is pruned with its session group", () => {
    const sd = path.join(TMP, "sessions");
    const old = (Date.now() - 40 * 24 * 3_600_000) / 1000;
    for (const f of ["N.ndjson", "N.cursor", "N.note"]) {
      const p = path.join(sd, f);
      fs.writeFileSync(p, "x");
      fs.utimesSync(p, old, old);
    }
    const res = pruneSessionFiles(TMP);
    expect(res.deleted.some((d) => d.endsWith("N.note"))).toBe(true);
  });
});

it("old session notes are soft-deleted to .trash; fresh ones kept", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sb-gc-vault-"));
  process.env.SUPERBRAIN_VAULT_DIR = vault;
  try {
    const dir = path.join(vault, "sessions");
    fs.mkdirSync(dir, { recursive: true });
    const oldNote = path.join(dir, "proj-1700000000.md");
    const freshNote = path.join(dir, "proj-1800000000.md");
    fs.writeFileSync(oldNote, "old");
    fs.writeFileSync(freshNote, "fresh");
    const old = (Date.now() - 40 * 24 * 3_600_000) / 1000;
    fs.utimesSync(oldNote, old, old);
    const res = pruneSessionNotes(vault);
    expect(res.deleted.length).toBe(1);
    expect(fs.existsSync(oldNote)).toBe(false);
    expect(fs.existsSync(freshNote)).toBe(true);
    expect(fs.readdirSync(path.join(vault, ".trash")).some((f) => f.includes("proj-1700000000"))).toBe(true);
  } finally {
    delete process.env.SUPERBRAIN_VAULT_DIR;
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
