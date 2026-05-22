#!/usr/bin/env -S node --experimental-strip-types
// scripts/retro-collapse-duplicates.ts
//
// Finds duplicate note clusters in the vault and proposes a collapse plan.
// Conservative: requires ≥20-char slug-prefix overlap, same date, same folder.
//
// Usage:
//   npx tsx scripts/retro-collapse-duplicates.ts <vault-dir> [--apply]

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CollapsePlan {
  canonical: string;    // relative path within vault
  duplicates: string[]; // paths to merge into canonical then delete
  reason: string;
}

export interface DailyRoutePlan {
  source: string;     // capture path to fix (relative)
  action: "move" | "delete";
  target?: string;    // for "move" — e.g. "daily/2026-05-20.md"
}

export interface RetroPlan {
  collapses: CollapsePlan[];
  dailyRoutes: DailyRoutePlan[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk one directory level; return filenames (not subdirs). */
function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => {
    const s = fs.statSync(path.join(dir, f));
    return s.isFile();
  });
}

/**
 * Extract the date prefix from a filename like "2026-05-20-some-slug.md".
 * Returns null if the file does not start with YYYY-MM-DD.
 */
function extractDate(filename: string): string | null {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : null;
}

/**
 * Extract the slug portion (everything after the date prefix, without extension).
 * "2026-05-20-superbrain-manual-inject-a.md" → "superbrain-manual-inject-a"
 */
function extractSlug(filename: string): string {
  return filename
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/\.md$/, "");
}

/**
 * Slug prefix used for grouping: first PREFIX_LEN characters of the slug.
 * A shorter prefix is used for initial bucketing; actual similarity is then
 * verified with sharedPrefixLen against a proportional threshold.
 */
const PREFIX_LEN = 20;
/** Minimum absolute shared-prefix chars to consider two slugs "similar". */
const MIN_SHARED_ABS = 6;
/** Minimum fraction of the shorter slug that must be a shared prefix. */
const MIN_SHARED_FRAC = 0.55;

function slugPrefix(slug: string): string {
  return slug.slice(0, PREFIX_LEN);
}

/**
 * Compute shared prefix length of two strings.
 */
function sharedPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Return true if two slugs are similar enough to be collapse candidates.
 * Conservative: shared prefix ≥ max(MIN_SHARED_ABS, MIN_SHARED_FRAC * shorter).
 */
function slugsSimilar(a: string, b: string): boolean {
  const shared = sharedPrefixLen(a, b);
  const shorter = Math.min(a.length, b.length);
  const threshold = Math.max(MIN_SHARED_ABS, Math.floor(shorter * MIN_SHARED_FRAC));
  return shared >= threshold;
}

/**
 * Choose the canonical (best) note from a cluster.
 * Tie-break order: longest file content → alphabetical filename.
 */
function pickCanonical(files: Array<{ rel: string; abs: string }>): { rel: string; abs: string } {
  return files.slice().sort((a, b) => {
    const sizeA = fs.statSync(a.abs).size;
    const sizeB = fs.statSync(b.abs).size;
    if (sizeB !== sizeA) return sizeB - sizeA; // longest first
    return a.rel < b.rel ? -1 : 1;             // alphabetical
  })[0];
}

// ---------------------------------------------------------------------------
// Core planning logic
// ---------------------------------------------------------------------------

type FileEntry = { rel: string; abs: string; slug: string; date: string };

/**
 * Union-Find: merge entries that are pairwise similar into clusters.
 * Returns arrays of clusters (each cluster has ≥2 members).
 */
function clusterBySimilarity(entries: FileEntry[]): FileEntry[][] {
  const parent = entries.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(i: number, j: number): void {
    parent[find(i)] = find(j);
  }

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].date === entries[j].date && slugsSimilar(entries[i].slug, entries[j].slug)) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, FileEntry[]>();
  for (let i = 0; i < entries.length; i++) {
    const root = find(i);
    const g = groups.get(root) ?? [];
    g.push(entries[i]);
    groups.set(root, g);
  }

  return Array.from(groups.values()).filter(g => g.length >= 2);
}

/**
 * Find duplicate clusters within a single folder.
 */
function findClustersInFolder(
  vaultDir: string,
  folder: string,
): CollapsePlan[] {
  const dir = path.join(vaultDir, folder);
  const files = listFiles(dir).filter(f => f.endsWith(".md"));

  const entries: FileEntry[] = [];
  for (const f of files) {
    const date = extractDate(f);
    if (!date) continue;
    const slug = extractSlug(f);
    entries.push({ rel: `${folder}/${f}`, abs: path.join(dir, f), slug, date });
  }

  const clusters = clusterBySimilarity(entries);
  const plans: CollapsePlan[] = [];

  for (const members of clusters) {
    const canonical = pickCanonical(members);
    const duplicates = members.filter(m => m.rel !== canonical.rel).map(m => m.rel);
    const date = members[0].date;
    plans.push({
      canonical: canonical.rel,
      duplicates,
      reason: `${members.length} files with similar slug on ${date} in ${folder}/`,
    });
  }

  return plans;
}

/**
 * Find mis-routed daily captures in capture/ folder.
 * Matches: capture/<date>-daily-<date>.md
 */
function findDailyRoutes(vaultDir: string): DailyRoutePlan[] {
  const captureDir = path.join(vaultDir, "capture");
  const files = listFiles(captureDir).filter(f => f.endsWith(".md"));
  const plans: DailyRoutePlan[] = [];

  for (const f of files) {
    // Match pattern: YYYY-MM-DD-daily-YYYY-MM-DD.md
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-daily-(\d{4}-\d{2}-\d{2})\.md$/);
    if (!m) continue;

    const targetDate = m[2]; // the date embedded in "daily-<date>"
    const targetRel = `daily/${targetDate}.md`;
    const targetAbs = path.join(vaultDir, targetRel);
    const sourceRel = `capture/${f}`;

    if (fs.existsSync(targetAbs)) {
      plans.push({ source: sourceRel, action: "delete" });
    } else {
      plans.push({ source: sourceRel, action: "move", target: targetRel });
    }
  }

  return plans;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Walk the vault and produce a collapse plan (pure, no writes). */
export function planRetro(vaultDir: string): RetroPlan {
  const folders = fs
    .readdirSync(vaultDir)
    .filter(f => fs.statSync(path.join(vaultDir, f)).isDirectory());

  const collapses: CollapsePlan[] = [];
  for (const folder of folders) {
    collapses.push(...findClustersInFolder(vaultDir, folder));
  }

  const dailyRoutes = findDailyRoutes(vaultDir);

  return { collapses, dailyRoutes };
}

/** Apply a RetroPlan: merge duplicates into canonicals and handle daily routes. */
export function applyRetro(vaultDir: string, plan: RetroPlan): void {
  // Apply collapses
  for (const collapse of plan.collapses) {
    const canonicalAbs = path.join(vaultDir, collapse.canonical);
    let canonicalContent = fs.readFileSync(canonicalAbs, "utf8");

    for (const dup of collapse.duplicates) {
      const dupAbs = path.join(vaultDir, dup);
      const dupContent = fs.readFileSync(dupAbs, "utf8");
      canonicalContent += `\n\n## Original from ${dup}\n\n${dupContent}`;
      fs.unlinkSync(dupAbs);
    }

    fs.writeFileSync(canonicalAbs, canonicalContent);
  }

  // Apply daily routes
  for (const route of plan.dailyRoutes) {
    const sourceAbs = path.join(vaultDir, route.source);
    if (route.action === "delete") {
      fs.unlinkSync(sourceAbs);
    } else if (route.action === "move" && route.target) {
      const targetAbs = path.join(vaultDir, route.target);
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.renameSync(sourceAbs, targetAbs);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const vault = args.find(a => !a.startsWith("--")) ?? process.env["SUPERBRAIN_VAULT"] ?? "";

  if (!vault) {
    console.error("usage: retro-collapse-duplicates.ts <vault-dir> [--apply]");
    process.exit(1);
  }

  if (!fs.existsSync(vault)) {
    console.error(`Vault not found: ${vault}`);
    process.exit(1);
  }

  const plan = planRetro(vault);

  console.log(`\n=== Collapse plan (${plan.collapses.length} clusters) ===\n`);
  for (const c of plan.collapses) {
    console.log(`CANONICAL: ${c.canonical}`);
    console.log(`  REASON : ${c.reason}`);
    for (const d of c.duplicates) {
      console.log(`  MERGE  : ${d}`);
    }
    console.log();
  }

  console.log(`=== Daily route fixes (${plan.dailyRoutes.length} files) ===\n`);
  for (const r of plan.dailyRoutes) {
    if (r.action === "move") {
      console.log(`MOVE   : ${r.source} → ${r.target}`);
    } else {
      console.log(`DELETE : ${r.source}  (real daily already exists)`);
    }
  }

  if (!apply) {
    console.log("\n(Dry-run. Use --apply to write changes.)");
    return;
  }

  applyRetro(vault, plan);
  console.log("\nApplied.");
}

const _isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("retro-collapse-duplicates.ts") ||
    process.argv[1].endsWith("retro-collapse-duplicates.js"));
if (_isMain) main();
