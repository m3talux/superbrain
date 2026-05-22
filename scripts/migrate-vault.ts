#!/usr/bin/env -S node --experimental-strip-types
// scripts/migrate-vault.ts
//
// LLM-driven vault migration: rewrites notes in decisions/, lessons/, capture/,
// and people/ to conform to v0.5 templates.
//
// Usage:
//   npx tsx scripts/migrate-vault.ts <vault> [--apply] [--concurrency=3] [--type=decision] [--limit=N]
//
// Dry-run by default — shows before/after for the first few notes.
// With --apply: writes changes, backs up originals to .trash/migration-<date>/.

import fs from "node:fs";
import path from "node:path";
import { claudeP } from "../src/claudeCli.js";
import { validateNote, type NoteType } from "../src/templates.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationPlanOptions {
  typeFilter?: string;
  limit?: number;
}

export interface ApplyOptions {
  apply: boolean;
  backupDate: string;
  concurrency: number;
}

export interface NoteProposal {
  relPath: string;
  absPath: string;
  type: NoteType;
  title: string;
  frontmatterRaw: string;
  bodyRaw: string;
  project: string;
  created: string;
}

export interface MigrationResult {
  relPath: string;
  status: "rewritten" | "skipped" | "dry-run";
  reason?: string;
  wordsBefore?: number;
  wordsAfter?: number;
  newBody?: string;
}

export type MigrationPlan = NoteProposal[];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SKIP_FOLDERS = new Set(["projects", "daily", "meta"]);

const FOLDER_TO_TYPE: Record<string, NoteType> = {
  decisions: "decision",
  lessons: "lesson",
  capture: "capture",
  people: "person",
};

const WORD_CEILINGS: Record<NoteType, number> = {
  decision: 350,
  lesson: 300,
  capture: 200,
  project: Infinity,
  daily: Infinity,
  person: 300,
};

const REQUIRED_SECTIONS: Record<NoteType, string[]> = {
  decision: ["## Decision", "## Why", "## Alternatives considered", "## Consequences"],
  lesson: ["## Rule", "## Why", "## When this applies"],
  capture: ["## What", "## Why it matters"],
  project: ["## What it is", "## Status", "## Architecture", "## Recent activity", "## Gotchas"],
  daily: ["## Worked on", "## Decisions", "## Lessons", "## Captures", "## Open threads"],
  person: ["## Role", "## Context", "## Interactions"],
};

// ---------------------------------------------------------------------------
// shouldSkip
// ---------------------------------------------------------------------------

/**
 * Returns true if this note should be skipped (not migrated).
 * Skips: projects/, daily/, meta/, projects/_archive/, frontmatter-only stubs.
 */
export function shouldSkip(relPath: string, raw: string): boolean {
  const topFolder = relPath.split("/")[0];
  if (SKIP_FOLDERS.has(topFolder)) return true;

  // Check if type is known/migratable
  if (!FOLDER_TO_TYPE[topFolder]) return true;

  // Skip frontmatter-only stubs (no meaningful body)
  const body = extractBody(raw);
  const trimmed = body.trim();
  if (!trimmed || trimmed.length < 5) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (no gray-matter dependency for portability)
// ---------------------------------------------------------------------------

function splitFrontmatter(raw: string): { fm: string; body: string } {
  if (!raw.startsWith("---")) return { fm: "", body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { fm: "", body: raw };
  const fm = raw.slice(0, end + 4); // includes closing ---
  const body = raw.slice(end + 4);
  return { fm, body };
}

function extractBody(raw: string): string {
  return splitFrontmatter(raw).body;
}

function parseFmValue(fm: string, key: string): string {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
}

// ---------------------------------------------------------------------------
// resolveWikilinks
// ---------------------------------------------------------------------------

/**
 * For each [[link]] in the body, attempt to resolve it against actual vault
 * files. Uses the wikilink index strategy: case-insensitive basename match,
 * strip date prefix, prefer longest filename match.
 *
 * Resolved links: kept as [[link]] (already valid Obsidian references).
 * Unresolved links: replaced with `[[broken: original-target]]`
 */
export function resolveWikilinks(body: string, vaultRoot: string): string {
  // Build a lookup: lowercase stem -> original relPath candidates
  const index = buildWikilinkIndex(vaultRoot);

  return body.replace(/\[\[([^\]]+)\]\]/g, (fullMatch, inner) => {
    // Handle pipe alias: [[target|alias]] → resolve target, keep alias display
    const pipeIdx = inner.indexOf("|");
    const target = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
    const alias = pipeIdx >= 0 ? inner.slice(pipeIdx) : ""; // includes the |

    const resolved = resolveOneLink(target.trim(), index);
    if (resolved !== null) {
      // Keep original wikilink form (Obsidian will resolve it)
      return `[[${target.trim()}${alias}]]`;
    }
    // Mark as broken — escaped backtick form so Obsidian doesn't render red
    const originalTarget = target.trim();
    return "`[[broken: " + originalTarget + "]]`";
  });
}

interface WikilinkIndex {
  // lowercase relPath (no .md) -> canonical relPath
  byRelPath: Map<string, string>;
  // lowercase stem (no date prefix) -> canonical relPaths
  byBasename: Map<string, string[]>;
}

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

function buildWikilinkIndex(vaultRoot: string): WikilinkIndex {
  const ix: WikilinkIndex = { byRelPath: new Map(), byBasename: new Map() };
  const folders = ["decisions", "lessons", "capture", "people", "projects", "daily", "meta", "maps"];
  for (const folder of folders) {
    const dir = path.join(vaultRoot, folder);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".md")) continue;
      const stem = f.slice(0, -3);
      const rel = `${folder}/${stem}`;
      ix.byRelPath.set(rel.toLowerCase(), rel);
      const stripped = stem.replace(DATE_PREFIX, "");
      for (const key of new Set([stem.toLowerCase(), stripped.toLowerCase()])) {
        const arr = ix.byBasename.get(key) ?? [];
        arr.push(rel);
        ix.byBasename.set(key, arr);
      }
    }
  }
  return ix;
}

function resolveOneLink(raw: string, ix: WikilinkIndex): string | null {
  // Strip .md suffix if present
  let target = raw.replace(/\.md$/i, "");

  // If it's a path like "decisions/foo", try byRelPath
  if (target.includes("/")) {
    return ix.byRelPath.get(target.toLowerCase()) ?? null;
  }

  // Try exact basename match
  const exact = ix.byBasename.get(target.toLowerCase());
  if (exact && exact.length > 0) {
    // Prefer the longest filename (most specific)
    return exact.slice().sort((a, b) => b.length - a.length)[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// buildMigrationPrompt
// ---------------------------------------------------------------------------

export interface PromptParams {
  type: NoteType;
  title: string;
  body: string;
  project: string;
  created: string;
}

export function buildMigrationPrompt(p: PromptParams): string {
  const sections = REQUIRED_SECTIONS[p.type];
  const ceiling = WORD_CEILINGS[p.type];
  const ceilingStr = Number.isFinite(ceiling) ? String(ceiling) : "unlimited";

  const skeleton = sections.map((s) => `${s}\n{content}`).join("\n\n");

  return [
    "You are migrating a note in a personal second-brain vault to a new strict template.",
    `Type: ${p.type}`,
    `Project: ${p.project}`,
    `Created: ${p.created}`,
    `Current title: ${p.title}`,
    "",
    "ORIGINAL BODY:",
    p.body,
    "",
    `REQUIRED OUTPUT FORMAT (for type=${p.type}):`,
    skeleton,
    "",
    "RULES:",
    "1. Preserve every factual claim and every direct quote.",
    `2. Compress verbose passages (target: ${ceilingStr} words MAX).`,
    "3. Use the new section names exactly as listed.",
    '4. Do NOT include "## See also" anywhere in the body — edges live in frontmatter.',
    "5. Keep [[wikilinks]] as they appear in the input — they have been pre-resolved.",
    "6. Output ONLY the new body markdown, NO frontmatter, NO surrounding ```markdown fences.",
    "7. The body MUST start with `# <title>` (the title can be the same as the input, or improved).",
    "",
    "Output:",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// planMigration
// ---------------------------------------------------------------------------

/**
 * Walk the vault and collect NoteProposal objects for all notes that should
 * be migrated. Does NOT call claude.
 */
export function planMigration(
  vaultRoot: string,
  options: MigrationPlanOptions = {}
): MigrationPlan {
  const { typeFilter, limit } = options;
  const proposals: NoteProposal[] = [];

  const folders = typeFilter
    ? [typeFolderFor(typeFilter)]
    : ["decisions", "lessons", "capture", "people"];

  for (const folder of folders) {
    if (!folder) continue;
    const dir = path.join(vaultRoot, folder);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const f of entries) {
      if (!f.endsWith(".md")) continue;
      const relPath = `${folder}/${f}`;
      const absPath = path.join(dir, f);
      const raw = fs.readFileSync(absPath, "utf8");

      if (shouldSkip(relPath, raw)) continue;

      const type = FOLDER_TO_TYPE[folder];
      const { fm, body } = splitFrontmatter(raw);

      // Extract title from first # heading in body
      const titleMatch = body.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : path.basename(f, ".md");

      const project = parseFmValue(fm, "project") || "global";
      const created = parseFmValue(fm, "created") || parseFmValue(fm, "date") || "unknown";

      proposals.push({ relPath, absPath, type, title, frontmatterRaw: fm, bodyRaw: body, project, created });

      if (limit && proposals.length >= limit) break;
    }

    if (limit && proposals.length >= limit) break;
  }

  return proposals;
}

function typeFolderFor(typeStr: string): string | null {
  for (const [folder, t] of Object.entries(FOLDER_TO_TYPE)) {
    if (t === typeStr || folder === typeStr) return folder;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Semaphore for concurrency control
// ---------------------------------------------------------------------------

function semaphore(concurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && running < concurrency) {
      running++;
      const fn = queue.shift()!;
      fn();
    }
  }

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            running--;
            next();
          });
      });
      next();
    });
  };
}

// ---------------------------------------------------------------------------
// applyMigration
// ---------------------------------------------------------------------------

/**
 * For each proposal: resolve wikilinks, call claudeP, validate, optionally write.
 */
export async function applyMigration(
  vaultRoot: string,
  plan: MigrationPlan,
  options: ApplyOptions
): Promise<MigrationResult[]> {
  const { apply, backupDate, concurrency } = options;
  const results: MigrationResult[] = [];
  const run = semaphore(concurrency);

  const tasks = plan.map((proposal, idx) =>
    run(async (): Promise<MigrationResult> => {
      const { relPath, absPath, type, title, frontmatterRaw, bodyRaw, project, created } = proposal;

      // Resolve wikilinks in the original body
      const resolvedBody = resolveWikilinks(bodyRaw, vaultRoot);

      // Build prompt
      const prompt = buildMigrationPrompt({ type, title, body: resolvedBody, project, created });

      // Call LLM
      let newBody: string;
      try {
        const raw = await Promise.resolve(claudeP(prompt));
        newBody = typeof raw === "string" ? raw : String(raw);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { relPath, status: "skipped", reason: `claudeP error: ${msg}` };
      }

      // Strip any accidental markdown fence wrapper
      newBody = stripFence(newBody);

      // Validate: frontmatter + new body
      const fullDoc = frontmatterRaw + newBody;
      const validation = validateNote(type, fullDoc);
      if (!validation.valid) {
        return {
          relPath,
          status: "skipped",
          reason: `validation failed: ${validation.errors.join("; ")}`,
        };
      }

      const wordsBefore = countWords(bodyRaw);
      const wordsAfter = countWords(newBody);

      if (!apply) {
        return { relPath, status: "dry-run", wordsBefore, wordsAfter, newBody };
      }

      // Backup original
      const backupDir = path.join(vaultRoot, ".trash", `migration-${backupDate}`, path.dirname(relPath));
      fs.mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(vaultRoot, ".trash", `migration-${backupDate}`, relPath);
      fs.copyFileSync(absPath, backupPath);

      // Write new content (frontmatter preserved, body replaced)
      const newContent = frontmatterRaw + newBody;
      fs.writeFileSync(absPath, newContent, "utf8");

      return { relPath, status: "rewritten", wordsBefore, wordsAfter, newBody };
    })
  );

  const settled = await Promise.allSettled(tasks);
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      results.push(s.value);
    } else {
      results.push({
        relPath: plan[i].relPath,
        status: "skipped",
        reason: `unexpected error: ${s.reason}`,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countWords(text: string): number {
  return text
    .replace(/^---[\s\S]*?\n---\n?/m, "")
    .replace(/^#+ .*$/gm, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

function stripFence(text: string): string {
  // Remove ```markdown ... ``` or ``` ... ``` wrappers if LLM added them
  return text.replace(/^```(?:markdown)?\n?([\s\S]*?)```\s*$/m, "$1").trim() + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const vaultArg = args.find((a) => !a.startsWith("--"));
  const vault = vaultArg || process.env["SUPERBRAIN_VAULT"] || "";

  if (!vault) {
    console.error(
      "usage: migrate-vault.ts <vault> [--apply] [--concurrency=3] [--type=<type>] [--limit=N]"
    );
    process.exit(1);
  }

  if (!fs.existsSync(vault)) {
    console.error(`Vault not found: ${vault}`);
    process.exit(1);
  }

  const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concurrencyArg ? parseInt(concurrencyArg.split("=")[1], 10) : 3;

  const typeArg = args.find((a) => a.startsWith("--type="));
  const typeFilter = typeArg ? typeArg.split("=")[1] : undefined;

  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;

  const backupDate = new Date().toISOString().slice(0, 10);

  console.log(`SuperBrain vault migration — v0.5 templates`);
  console.log(`Vault: ${vault}`);
  console.log(`Mode: ${apply ? "APPLY" : "dry-run"}`);
  if (typeFilter) console.log(`Type filter: ${typeFilter}`);
  console.log("");

  const plan = planMigration(vault, { typeFilter, limit });

  if (plan.length === 0) {
    console.log("No notes to migrate. All up to date or vault is empty.");
    return;
  }

  console.log(`Found ${plan.length} notes to migrate (concurrency=${concurrency})\n`);

  const results = await applyMigration(vault, plan, { apply, backupDate, concurrency });

  let rewritten = 0;
  let skipped = 0;
  let dryRun = 0;
  let sampleShown = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const n = `[${i + 1}/${results.length}]`;

    if (r.status === "rewritten") {
      rewritten++;
      console.log(
        `${n} ${r.relPath} — ✓ rewritten (${r.wordsBefore}→${r.wordsAfter} words)`
      );
    } else if (r.status === "dry-run") {
      dryRun++;
      const preview = sampleShown < 3;
      console.log(
        `${n} ${r.relPath} — [dry-run] would rewrite (${r.wordsBefore}→${r.wordsAfter} words)`
      );
      if (preview) {
        sampleShown++;
        const proposal = plan[i];
        console.log(`\n  --- BEFORE (body excerpt, first 200 chars) ---`);
        console.log(
          "  " +
            proposal.bodyRaw
              .trim()
              .slice(0, 200)
              .replace(/\n/g, "\n  ")
        );
        console.log(`\n  --- AFTER (body excerpt, first 200 chars) ---`);
        console.log(
          "  " +
            (r.newBody ?? "")
              .trim()
              .slice(0, 200)
              .replace(/\n/g, "\n  ")
        );
        console.log("");
      }
    } else {
      skipped++;
      console.log(`${n} ${r.relPath} — × skipped (${r.reason ?? "unknown"})`);
    }
  }

  console.log(
    `\nDone. rewritten=${rewritten} skipped=${skipped} dry-run=${dryRun}`
  );
  if (!apply && dryRun > 0) {
    console.log("(Use --apply to write changes and back up originals.)");
  }
}

if (
  process.argv[1]?.endsWith("migrate-vault.ts") ||
  process.argv[1]?.endsWith("migrate-vault.js")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
