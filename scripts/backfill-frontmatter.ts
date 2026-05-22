#!/usr/bin/env -S node --experimental-strip-types
// scripts/backfill-frontmatter.ts
//
// Walk an existing vault and backfill missing frontmatter fields:
//   - type   (inferred from folder)
//   - project (inferred from path or body content; defaults to "global")
//   - date normalization: quoted ISO dates → bare ISO dates
//
// Usage:
//   npx tsx scripts/backfill-frontmatter.ts <vault-dir>          # dry-run
//   npx tsx scripts/backfill-frontmatter.ts <vault-dir> --apply  # write

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackfillProposal {
  file: string; // absolute path
  relPath: string; // relative to vault root
  changes: Array<{ field: string; value: any }>;
}

// ---------------------------------------------------------------------------
// Folder → type mapping
// ---------------------------------------------------------------------------

const FOLDER_TYPE: Record<string, string> = {
  decisions: "decision",
  lessons: "lesson",
  capture: "capture",
  projects: "project",
  daily: "daily",
  people: "person",
  meta: "preference",
};

// Folders where project should NOT be inferred/added
const NO_PROJECT_FOLDERS = new Set(["daily", "people", "meta"]);

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

/**
 * Infer note type from its relative path within the vault.
 * Returns null for unknown folders or top-level files.
 */
export function inferType(relPath: string): string | null {
  const parts = relPath.split("/");
  if (parts.length < 2) return null;

  const topFolder = parts[0];

  // projects/_archive/ is still type "project"
  if (topFolder === "projects") return "project";

  return FOLDER_TYPE[topFolder] ?? null;
}

// ---------------------------------------------------------------------------
// Project inference
// ---------------------------------------------------------------------------

/**
 * Infer the project slug for a note.
 *
 * Rules:
 *   - projects/<name>.md          → <name>
 *   - projects/_archive/<name>-<YYYY>-Q<n>.md → prefix before -<YYYY>
 *   - daily/, people/, meta/      → null (no project)
 *   - others: scan body for a known project name (case-insensitive slug match)
 *   - fallback                    → "global"
 */
export function inferProject(
  relPath: string,
  body: string,
  knownProjects: string[]
): string | null {
  const parts = relPath.split("/");
  const topFolder = parts[0];

  // No project for these folders
  if (NO_PROJECT_FOLDERS.has(topFolder)) return null;

  if (topFolder === "projects") {
    const basename = path.basename(relPath, ".md");

    // _archive/<name>-<YYYY>-Q<n>.md  or  _archive/<name>-<YYYY>-Q<n>
    if (parts[1] === "_archive") {
      // Strip suffix: -YYYY-Qn or -YYYY at end
      const slug = basename.replace(/-\d{4}-Q\d+$/, "").replace(/-\d{4}$/, "");
      return slug || basename;
    }

    return basename;
  }

  // For other folders: try to match body against known project slugs
  if (knownProjects.length > 0) {
    const lowerBody = body.toLowerCase();
    for (const proj of knownProjects) {
      // Match slug as a word boundary (handle hyphens in slug)
      const pattern = proj.toLowerCase().replace(/-/g, "[- ]");
      const re = new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`, "i");
      if (re.test(lowerBody)) {
        return proj;
      }
    }
  }

  return "global";
}

// ---------------------------------------------------------------------------
// Date normalization
// ---------------------------------------------------------------------------

const DATE_FIELDS = ["created", "date", "last_touched", "updated", "superseded_at"];
// Matches: fieldname: 'YYYY-MM-DD' or fieldname: "YYYY-MM-DD"
const QUOTED_DATE_RE = /^(['"])(\d{4}-\d{2}-\d{2})\1$/;

/**
 * Normalize frontmatter in a raw note string.
 * Strips quotes from ISO date fields, reports what changed.
 */
export function normalizeFrontmatter(raw: string): {
  changed: boolean;
  newRaw: string;
  changes: BackfillProposal["changes"];
} {
  // Check for frontmatter block
  if (!raw.startsWith("---")) {
    return { changed: false, newRaw: raw, changes: [] };
  }

  const endIdx = raw.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { changed: false, newRaw: raw, changes: [] };
  }

  const fmBlock = raw.slice(0, endIdx + 4); // includes closing ---
  const rest = raw.slice(endIdx + 4);

  const changes: BackfillProposal["changes"] = [];
  let newFmBlock = fmBlock;

  for (const field of DATE_FIELDS) {
    // Match: "field: 'date'" or "field: \"date\""
    const lineRe = new RegExp(`^(${field}: )(['"])(\\d{4}-\\d{2}-\\d{2})\\2$`, "m");
    const match = newFmBlock.match(lineRe);
    if (match) {
      const bareDate = match[3];
      newFmBlock = newFmBlock.replace(lineRe, `$1${bareDate}`);
      changes.push({ field, value: bareDate });
    }
  }

  const changed = newFmBlock !== fmBlock;
  return { changed, newRaw: newFmBlock + rest, changes };
}

// ---------------------------------------------------------------------------
// Parse raw frontmatter into key-value map (minimal, no gray-matter dep)
// ---------------------------------------------------------------------------

function parseFrontmatterKeys(raw: string): Record<string, string> | null {
  if (!raw.startsWith("---")) return null;
  const endIdx = raw.indexOf("\n---", 3);
  if (endIdx === -1) return null;

  const fmLines = raw.slice(4, endIdx).split("\n");
  const result: Record<string, string> = {};
  for (const line of fmLines) {
    const m = line.match(/^(\w[\w_-]*): ?(.*)$/);
    if (m) {
      result[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return result;
}

/**
 * Insert or update a frontmatter field in raw note text.
 * If the field already exists, replaces it. Otherwise inserts after "---\n".
 */
function setFrontmatterField(raw: string, field: string, value: any): string {
  const strVal = String(value);
  const fieldLine = `${field}: ${strVal}`;

  // Check if field exists (possibly with quotes)
  const existsRe = new RegExp(`^${field}: .*$`, "m");
  if (existsRe.test(raw)) {
    return raw.replace(existsRe, fieldLine);
  }

  // Insert after opening "---\n"
  const insertIdx = raw.indexOf("\n", 3) + 1; // after first "---\n"
  return raw.slice(0, insertIdx) + fieldLine + "\n" + raw.slice(insertIdx);
}

// ---------------------------------------------------------------------------
// Walk vault and collect known projects
// ---------------------------------------------------------------------------

function collectKnownProjects(vaultDir: string): string[] {
  const projectsDir = path.join(vaultDir, "projects");
  if (!fs.existsSync(projectsDir)) return [];

  const projects: string[] = [];
  for (const entry of fs.readdirSync(projectsDir)) {
    if (entry === "_archive") continue;
    if (entry.endsWith(".md")) {
      projects.push(path.basename(entry, ".md"));
    }
  }
  return projects;
}

function walkVault(vaultDir: string): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden dirs and node_modules
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(full);
      }
    }
  }

  walk(vaultDir);
  return files;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Walk the vault, compute proposals for every note that needs changes.
 */
export function planBackfill(vaultDir: string): BackfillProposal[] {
  const knownProjects = collectKnownProjects(vaultDir);
  const allFiles = walkVault(vaultDir);
  const proposals: BackfillProposal[] = [];

  for (const file of allFiles) {
    const relPath = path.relative(vaultDir, file).replace(/\\/g, "/");
    const raw = fs.readFileSync(file, "utf8");

    // Parse current frontmatter keys
    const fm = parseFrontmatterKeys(raw);
    const changes: BackfillProposal["changes"] = [];

    // --- Date normalization ---
    const dateResult = normalizeFrontmatter(raw);
    changes.push(...dateResult.changes);

    // Working copy of raw (with dates normalized for subsequent checks)
    let workingRaw = dateResult.newRaw;

    // --- Type inference ---
    const currentType = fm?.["type"];
    if (!currentType) {
      const inferredType = inferType(relPath);
      if (inferredType) {
        changes.push({ field: "type", value: inferredType });
        workingRaw = setFrontmatterField(workingRaw, "type", inferredType);
      }
    }

    // --- Project inference ---
    // Determine effective type (current or inferred)
    const effectiveType = currentType || (changes.find(c => c.field === "type")?.value as string | undefined);
    const effectiveFolder = relPath.split("/")[0];
    const needsProject = !NO_PROJECT_FOLDERS.has(effectiveFolder) && effectiveType !== "daily";

    if (needsProject && !fm?.["project"]) {
      // Extract body content (after frontmatter)
      let body = "";
      if (raw.startsWith("---")) {
        const endIdx = raw.indexOf("\n---", 3);
        if (endIdx !== -1) body = raw.slice(endIdx + 4);
      }
      const inferredProject = inferProject(relPath, body, knownProjects);
      if (inferredProject !== null) {
        changes.push({ field: "project", value: inferredProject });
      }
    }

    if (changes.length > 0) {
      proposals.push({ file, relPath, changes });
    }
  }

  return proposals;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Write proposals back to disk.
 */
export function applyBackfill(proposals: BackfillProposal[]): void {
  for (const proposal of proposals) {
    let raw = fs.readFileSync(proposal.file, "utf8");

    for (const change of proposal.changes) {
      if (change.field === "type" || change.field === "project") {
        raw = setFrontmatterField(raw, change.field, change.value);
      } else {
        // Date fields: strip quotes (normalizeFrontmatter handles the text replacement)
        const re = new RegExp(`^(${change.field}: )(['"])(\\d{4}-\\d{2}-\\d{2})\\2$`, "m");
        raw = raw.replace(re, `$1${change.value}`);
      }
    }

    fs.writeFileSync(proposal.file, raw, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const vault = args.find(a => !a.startsWith("--")) || process.env["SUPERBRAIN_VAULT"];

  if (!vault) {
    console.error("usage: backfill-frontmatter.ts <vault-dir> [--apply]");
    process.exit(1);
  }

  if (!fs.existsSync(vault)) {
    console.error(`Vault not found: ${vault}`);
    process.exit(1);
  }

  const proposals = planBackfill(vault);

  if (proposals.length === 0) {
    console.log("All notes already conform. Nothing to do.");
    return;
  }

  if (!apply) {
    console.log(`Dry-run: would update ${proposals.length} notes`);
    for (const p of proposals) {
      const changeStr = p.changes
        .map(c => {
          if (c.field === "type") return `add type=${c.value}`;
          if (c.field === "project") return `add project=${c.value}`;
          return `normalize ${c.field}`;
        })
        .join(", ");
      console.log(`  - ${p.relPath}: ${changeStr}`);
    }
    console.log("\n(Dry-run. Use --apply to write changes.)");
  } else {
    applyBackfill(proposals);
    console.log(`Updated ${proposals.length} notes.`);
  }
}

if (
  process.argv[1]?.endsWith("backfill-frontmatter.ts") ||
  process.argv[1]?.endsWith("backfill-frontmatter.js")
) {
  main();
}
