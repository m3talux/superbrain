#!/usr/bin/env -S node --experimental-strip-types
// scripts/cleanup-daily-mirrors.ts
//
// Non-destructive migration: remove legacy "daily-mirror" capture notes left
// by the now-removed daily-rollup synthesizer, and strip dangling links to them.
//
// Mirror notes match the pattern: capture/<YYYY-MM-DD>-daily-<YYYY-MM-DD>.md
//
// Usage:
//   npx tsx scripts/cleanup-daily-mirrors.ts <vault-dir>          # dry-run
//   npx tsx scripts/cleanup-daily-mirrors.ts <vault-dir> --apply  # write

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MirrorEntry {
  file: string;
  relPath: string;
  basename: string;
}

export interface LinkPatch {
  file: string;
  relPath: string;
  newContent: string;
}

export interface MirrorPlan {
  mirrors: MirrorEntry[];
  linkPatches: LinkPatch[];
}

// ---------------------------------------------------------------------------
// Mirror detection
// ---------------------------------------------------------------------------

const MIRROR_BASENAME_RE = /^\d{4}-\d{2}-\d{2}-daily-\d{4}-\d{2}-\d{2}$/;
const SKIP_DIRS = new Set([".trash", ".obsidian", ".git", "node_modules"]);

export function isMirrorNote(relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.length < 2) return false;
  if (parts[0] !== "capture") return false;
  const basename = path.basename(relPath, ".md");
  return MIRROR_BASENAME_RE.test(basename);
}

// ---------------------------------------------------------------------------
// Vault walker
// ---------------------------------------------------------------------------

function walkVault(vaultDir: string): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.join(dir, entry.name));
      }
    }
  }

  walk(vaultDir);
  return files;
}

// ---------------------------------------------------------------------------
// Link removal
// ---------------------------------------------------------------------------

function buildLinkPattern(mirrorSlugs: string[]): RegExp | null {
  if (mirrorSlugs.length === 0) return null;
  const escaped = mirrorSlugs.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const inner = escaped.join("|");
  return new RegExp(`\\[\\[(${inner})(?:[#|][^\\]]*)?\\]\\]`, "g");
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function planCleanup(vaultDir: string): MirrorPlan {
  const allFiles = walkVault(vaultDir);
  const mirrors: MirrorEntry[] = [];

  for (const file of allFiles) {
    const relPath = path.relative(vaultDir, file).replace(/\\/g, "/");
    if (isMirrorNote(relPath)) {
      mirrors.push({ file, relPath, basename: path.basename(relPath, ".md") });
    }
  }

  const mirrorSlugs = mirrors.map(m => `capture/${m.basename}`);
  const linkPattern = buildLinkPattern(mirrorSlugs);

  const linkPatches: LinkPatch[] = [];

  if (linkPattern) {
    for (const file of allFiles) {
      const relPath = path.relative(vaultDir, file).replace(/\\/g, "/");
      if (mirrors.some(m => m.file === file)) continue;

      const content = fs.readFileSync(file, "utf8");
      if (!linkPattern.test(content)) continue;

      linkPattern.lastIndex = 0;
      const newContent = content.replace(linkPattern, "");
      linkPatches.push({ file, relPath, newContent });
    }
  }

  return { mirrors, linkPatches };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export function applyCleanup(vaultDir: string, plan: MirrorPlan): void {
  const trashDir = path.join(vaultDir, ".trash");
  fs.mkdirSync(trashDir, { recursive: true });

  const timestamp = Date.now();

  for (const mirror of plan.mirrors) {
    const dest = path.join(trashDir, `${timestamp}-${mirror.basename}.md`);
    fs.renameSync(mirror.file, dest);
  }

  for (const patch of plan.linkPatches) {
    fs.writeFileSync(patch.file, patch.newContent, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const vault = args.find(a => !a.startsWith("--")) || process.env["SUPERBRAIN_VAULT_DIR"];

  if (!vault) {
    console.error("usage: cleanup-daily-mirrors.ts <vault-dir> [--apply]");
    process.exit(1);
  }

  if (!fs.existsSync(vault)) {
    console.error(`Vault not found: ${vault}`);
    process.exit(1);
  }

  const plan = planCleanup(vault);

  if (plan.mirrors.length === 0 && plan.linkPatches.length === 0) {
    console.log("No daily-mirror notes found. Nothing to do.");
    return;
  }

  if (!apply) {
    console.log(`Dry-run: would soft-delete ${plan.mirrors.length} mirror note(s) and patch ${plan.linkPatches.length} file(s)`);
    for (const m of plan.mirrors) {
      console.log(`  trash: ${m.relPath}`);
    }
    for (const p of plan.linkPatches) {
      console.log(`  patch: ${p.relPath}`);
    }
    console.log("\n(Dry-run. Use --apply to write changes.)");
  } else {
    applyCleanup(vault, plan);
    console.log(`Soft-deleted ${plan.mirrors.length} mirror note(s), patched ${plan.linkPatches.length} file(s).`);
  }
}

if (
  process.argv[1]?.endsWith("cleanup-daily-mirrors.ts") ||
  process.argv[1]?.endsWith("cleanup-daily-mirrors.js")
) {
  main();
}
