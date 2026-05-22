#!/usr/bin/env -S node --experimental-strip-types
// scripts/retro-prune-preferences.ts
//
// Classifies each entry in meta/preferences.md into KEEP, DEMOTE-TO-LESSON,
// or DEMOTE-TO-PROJECT, then either prints a dry-run diff or applies changes.
//
// Usage:
//   npx tsx scripts/retro-prune-preferences.ts <vault-dir> [--apply]

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Entry {
  text: string;
  source: string; // e.g. "Code style > line 11" — for display only
}

export interface Classification {
  entry: Entry;
  verdict: "keep" | "demote-lesson" | "demote-project";
  projectSlug?: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// Imperative first-word allow-list (same as isPromotable in preferenceCandidates.ts)
const IMPERATIVE_PREFIXES = [
  "always", "never", "prefer", "default", "don't", "do not", "avoid", "use",
];

// Additional imperative openers that begin with a context clause.
// "When X, do Y"  /  "Before X, do Y"  /  "As the implementer, …" are all
// directives — keep them rather than demoting as non-imperative.
const CONDITIONAL_IMPERATIVE_RE = /^(when|before|after|as the|for well-scoped|on novel)\b/i;

/**
 * Parse meta/preferences.md and return each individual preference entry.
 *
 * The file uses two possible formats (or a mix):
 *   A) "## Category" headings with "- bullet" children → each bullet is an entry.
 *   B) "## Entry heading" with no bullet children → the heading itself is an entry.
 *
 * Frontmatter (--- … ---) and bare paragraph lines are skipped.
 */
export function parsePreferences(content: string): Entry[] {
  // Strip YAML frontmatter
  const body = content.replace(/^---[\s\S]*?---\s*\n/, "");

  const lines = body.split("\n");
  const entries: Entry[] = [];

  let currentCategory = "";
  let pendingHeading: { text: string; line: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ## heading
    if (line.startsWith("## ")) {
      // If the previous heading had no bullet children, it is itself an entry
      if (pendingHeading) {
        entries.push({
          text: pendingHeading.text,
          source: `line ${pendingHeading.line + 1}`,
        });
      }

      const headingText = line.slice(3).trim();

      // Heuristic: a heading is a "category" (not itself an entry) when it is a
      // short title with no colon and starts with an uppercase letter, AND it
      // has bullet children below it.  We defer the decision until we see what
      // follows.  Store it as pending.
      pendingHeading = { text: headingText, line: i };
      currentCategory = headingText;
      continue;
    }

    // "- " bullet entry
    if (line.match(/^- /)) {
      // Seeing a bullet means the current heading is a category, not an entry.
      pendingHeading = null;

      const bulletText = line.slice(2).trim();
      if (bulletText) {
        entries.push({
          text: bulletText,
          source: currentCategory || `line ${i + 1}`,
        });
      }
      continue;
    }

    // Continuation of a bullet (indented text following a bullet) — append to last entry
    if (line.match(/^  +\S/) && entries.length > 0) {
      // Part of a multi-line bullet; append to the previous entry's text
      entries[entries.length - 1].text += " " + line.trim();
      continue;
    }

    // Non-empty, non-heading, non-bullet line: paragraph — skip (it's a preamble or body)
    // But if we have a pending heading, a paragraph body belongs to that heading-entry.
    // We treat the heading itself as the entry text and ignore the body.
  }

  // Flush any trailing heading that had no bullet children
  if (pendingHeading) {
    entries.push({
      text: pendingHeading.text,
      source: `line ${pendingHeading.line + 1}`,
    });
  }

  return entries.filter(e => e.text.length > 0);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a single preference text into keep / demote-lesson / demote-project.
 *
 * Rules:
 *   KEEP            imperative first word/phrase, no project-slug scope qualifier.
 *                   There is no length cap — real preferences in this vault are long.
 *   DEMOTE-PROJECT  matches /^for <single-word-slug>:/i where the slug is a proper
 *                   noun (single CamelCase or lowercase word, not a multi-word phrase).
 *                   e.g. "For Weddy: …" → project slug "weddy"
 *                   but  "For CLI tools: …" → NOT a project slug → keep
 *   DEMOTE-LESSON   clear past-tense observations ("I learned…", "We got burned…",
 *                   "We discovered…") that carry no actionable directive.
 *
 * Conservative by design: when uncertain, KEEP.
 */
export function classify(text: string): { verdict: Classification["verdict"]; projectSlug?: string } {
  const trimmed = text.trim();

  // Project-scoped: "for <single-word slug>: ..." only.
  // A project slug is a single word (letters/digits/hyphens only, no spaces).
  // Multi-word phrases like "CLI tools", "OG images", "Go linting" are context
  // qualifiers, not project names → do NOT match.
  const projectMatch = trimmed.match(/^for\s+([\w-]+)\s*:\s/i);
  if (projectMatch) {
    const slug = projectMatch[1];
    // Reject if the text immediately after "for <slug>:" is clearly a tech/context term
    // by checking whether the slug contains only a single token with no spaces (already
    // guaranteed by the regex) AND is not a generic lowercase tech abbreviation.
    // Heuristic: if the character right before the colon was a space or the slug
    // contains a slash, it's a phrase — but the regex already strips those.
    // Additional guard: common non-project tokens that look like slugs.
    const genericTokens = new Set([
      "cli", "api", "ui", "go", "og", "ci", "pr", "rfc", "jira",
      "v0", "v1", "v2", "v0.1", "v1.0",
    ]);
    if (!genericTokens.has(slug.toLowerCase())) {
      return {
        verdict: "demote-project",
        projectSlug: slug.toLowerCase(),
      };
    }
  }

  // Clear past-tense / narrative observations — demote to lesson.
  // Only catch strongly past-tense openers; err on the side of KEEP.
  const pastTenseRe = /^(i learned|we learned|i found|we found|we got burned|we discovered|i discovered|it turned out|we realized|i realized)\b/i;
  if (pastTenseRe.test(trimmed)) {
    return { verdict: "demote-lesson" };
  }

  // Imperative check — first word or first two words
  const words = trimmed.toLowerCase().split(/\s+/);
  const firstWord = words[0] ?? "";
  const firstTwo = words.slice(0, 2).join(" ");
  const isImperative = IMPERATIVE_PREFIXES.some(p => firstWord === p || firstTwo === p);

  if (isImperative) {
    return { verdict: "keep" };
  }

  // Conditional imperatives: "When X, do Y" / "Before X, always Y" / etc.
  // These are directives with a context qualifier — keep them.
  if (CONDITIONAL_IMPERATIVE_RE.test(trimmed)) {
    return { verdict: "keep" };
  }

  // "For <context>: <imperative body>" — context-qualified directive, keep it.
  // (The project-slug case was already handled above.)
  if (/^for\s+/i.test(trimmed)) {
    return { verdict: "keep" };
  }

  // "As the implementer, …" / "Second brain: …" / "Frontend: …" — tool/role notes
  // that are still durable directives. Keep conservatively.
  // Conservative default: KEEP when uncertain.
  return { verdict: "keep" };
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

/**
 * Derive a lessons/<date>-<slug>.md filename from an entry text and a date string.
 * Slug is kebab-cased, truncated so the total base-name (date + slug) ≤ 70 chars.
 */
export function demoteLessonFilename(text: string, today: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")  // drop punctuation
    .trim()
    .replace(/\s+/g, "-")           // spaces → dashes
    .replace(/-+/g, "-")            // collapse multiple dashes
    .slice(0, 50)                   // max slug length
    .replace(/-+$/, "");            // strip trailing dash
  return `${today}-${slug}.md`;
}

// ---------------------------------------------------------------------------
// Apply helpers
// ---------------------------------------------------------------------------

function buildPreferencesContent(kept: Entry[]): string {
  const header =
    `---\ntype: preference\nupdated: '${today()}'\nsuperbrain: true\n---\n` +
    `Durable opinions about how Claude should code, communicate, and choose tools.\n\n`;

  if (kept.length === 0) return header;

  const lines = kept.map(e => `- ${e.text}`).join("\n");
  return header + `## Preferences\n\n${lines}\n`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function lessonContent(text: string): string {
  const date = today();
  return (
    `---\ntype: lesson\ncreated: '${date}'\nsuperbrain: true\n---\n\n` +
    `${text}\n`
  );
}

function projectGotchaBlock(text: string): string {
  return `\n## Gotcha\n\n${text}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const vault = args.find(a => !a.startsWith("--")) ?? process.env["SUPERBRAIN_VAULT"] ?? "";

  if (!vault) {
    console.error("usage: retro-prune-preferences.ts <vault-dir> [--apply]");
    process.exit(1);
  }

  const file = path.join(vault, "meta", "preferences.md");
  if (!fs.existsSync(file)) {
    console.error(`Not found: ${file}`);
    process.exit(1);
  }

  const content = fs.readFileSync(file, "utf8");
  const entries = parsePreferences(content);

  const classifications: Classification[] = entries.map(e => ({
    entry: e,
    ...classify(e.text),
  }));

  const kept = classifications.filter(c => c.verdict === "keep");
  const lessons = classifications.filter(c => c.verdict === "demote-lesson");
  const projects = classifications.filter(c => c.verdict === "demote-project");

  const date = today();

  // --- Print report ---
  console.log(`\nKEEP (${kept.length} entries):`);
  for (const c of kept) {
    const preview = c.entry.text.length > 90
      ? c.entry.text.slice(0, 87) + "…"
      : c.entry.text;
    console.log(`  [${c.entry.source}] "${preview}"`);
  }

  console.log(`\nDEMOTE TO lessons/ (${lessons.length} entries):`);
  for (const c of lessons) {
    const fname = demoteLessonFilename(c.entry.text, date);
    const preview = c.entry.text.length > 80
      ? c.entry.text.slice(0, 77) + "…"
      : c.entry.text;
    console.log(`  "${preview}"\n    → lessons/${fname}`);
  }

  console.log(`\nDEMOTE TO projects/ (${projects.length} entries):`);
  for (const c of projects) {
    const preview = c.entry.text.length > 80
      ? c.entry.text.slice(0, 77) + "…"
      : c.entry.text;
    console.log(`  "${preview}"\n    → projects/${c.projectSlug}.md (Gotchas section)`);
  }

  if (!apply) {
    console.log("\n(Dry-run. Use --apply to write changes.)");
    return;
  }

  // --- Apply ---

  // Safety: backup original
  const bakFile = file + ".bak";
  fs.copyFileSync(file, bakFile);
  console.log(`\nBacked up original to ${bakFile}`);

  // Rewrite meta/preferences.md with only kept entries
  fs.writeFileSync(file, buildPreferencesContent(kept.map(c => c.entry)));

  // Write lesson files
  let createdLessons = 0;
  const lessonsDir = path.join(vault, "lessons");
  fs.mkdirSync(lessonsDir, { recursive: true });

  for (const c of lessons) {
    const fname = demoteLessonFilename(c.entry.text, date);
    const dest = path.join(lessonsDir, fname);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, lessonContent(c.entry.text));
      createdLessons++;
    }
  }

  // Append gotchas to project files
  let appendedProjects = 0;
  const projectsDir = path.join(vault, "projects");
  fs.mkdirSync(projectsDir, { recursive: true });

  for (const c of projects) {
    const slug = c.projectSlug!;
    const dest = path.join(projectsDir, `${slug}.md`);
    const block = projectGotchaBlock(c.entry.text);
    if (fs.existsSync(dest)) {
      fs.appendFileSync(dest, block);
    } else {
      const header =
        `---\ntype: project\ntitle: ${slug}\ncreated: '${date}'\nsuperbrain: true\n---\n\n` +
        `# ${slug}\n${block}`;
      fs.writeFileSync(dest, header);
    }
    appendedProjects++;
  }

  console.log(
    `Applied. meta/preferences.md now has ${kept.length} entries; ` +
    `created ${createdLessons} lesson files; ` +
    `appended ${appendedProjects} project gotchas.`
  );
}

// Only run when invoked directly (not when imported by tests)
const _isMain = process.argv[1] &&
  (process.argv[1].endsWith("retro-prune-preferences.ts") ||
   process.argv[1].endsWith("retro-prune-preferences.js"));
if (_isMain) main();
