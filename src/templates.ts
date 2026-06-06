// Templates module — canonical note templates, render, and validate per type.
// Pure string concatenation only; no YAML library required.

import type { NoteType } from "./types.js";
export type { NoteType } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface RenderFields {
  frontmatter: Record<string, unknown>;
  title?: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORD_CEILINGS: Record<NoteType, number> = {
  decision: 350,
  lesson: 300,
  capture: 200,
  project: Infinity,
  daily: Infinity,
  person: 300,
};

export const REQUIRED_SECTIONS: Record<NoteType, string[]> = {
  decision: ["## Decision", "## Why", "## Alternatives considered", "## Consequences"],
  lesson: ["## Rule", "## Why", "## When this applies"],
  capture: ["## What", "## Why it matters"],
  project: ["## What it is", "## Status", "## Architecture", "## Recent activity", "## Gotchas"],
  daily: ["## Summary", "## Also did"],
  person: ["## Role", "## Context", "## Interactions"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract content of a named ## Section up to the next ## heading or end. */
function extractSection(body: string, name: string): string {
  const m = body.match(
    new RegExp(`## ${escapeRegex(name)}\\n([\\s\\S]*?)(?=\\n## |$)`)
  );
  return m ? m[1] : "";
}

function renderFrontmatter(fm: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.join(", ")}]`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Per-type render helpers (match §4 of the spec exactly)
// ---------------------------------------------------------------------------

function renderDecision(fields: RenderFields): string {
  const title = fields.title ?? "{Imperative title — what was decided}";
  return [
    `# ${title}`,
    "",
    "## Decision",
    "{One paragraph. Imperative. No \"we decided that\".}",
    "",
    "## Why",
    "{Bullets. The constraint or evidence that forced the choice.}",
    "",
    "## Alternatives considered",
    "- **{Alternative A}** — rejected because {reason}.",
    "- **{Alternative B}** — rejected because {reason}.",
    "",
    "## Consequences",
    "{Bullets. What this enables, forecloses, or requires watching for.}",
    "",
  ].join("\n");
}

function renderLesson(fields: RenderFields): string {
  const title = fields.title ?? "{Rule, in imperative}";
  return [
    `# ${title}`,
    "",
    "## Rule",
    "{One or two sentences.}",
    "",
    "## Why",
    "{What happened. Date and quote if available.}",
    "",
    "## When this applies",
    "{Single sentence on scope.}",
    "",
  ].join("\n");
}

function renderCapture(fields: RenderFields): string {
  const title = fields.title ?? "{Specific, scannable title — not a sentence}";
  return [
    `# ${title}`,
    "",
    "## What",
    "{One paragraph.}",
    "",
    "## Why it matters",
    "{One or two sentences.}",
    "",
  ].join("\n");
}

function renderProject(fields: RenderFields): string {
  const title = fields.title ?? "Project";
  return [
    `# ${title}`,
    "",
    "## What it is",
    "{One paragraph.}",
    "",
    "## Status",
    "{One paragraph. Current state, version, next milestone.}",
    "",
    "## Architecture",
    "{Bullets or one paragraph. Stable structural facts.}",
    "",
    "## Recent activity",
    "### {YYYY-MM-DD}",
    "{1-3 lines.}",
    "",
    "## Gotchas",
    "- {≤1 line each.}",
    "",
  ].join("\n");
}

function renderDaily(fields: RenderFields): string {
  const title = fields.title ?? "{YYYY-MM-DD}";
  return [
    `# ${title}`,
    "",
    "## Summary",
    "- {one-line digest per session}",
    "",
    "## Decisions & gotchas",
    "- [[decisions/{slug}]] — {title}",
    "",
    "## Also did",
    "- {free-text items not tied to a specific note}",
    "",
    "## Threads open",
    "- {open thread or question}",
    "",
  ].join("\n");
}

function renderPerson(fields: RenderFields): string {
  const title = fields.title ?? "{Name}";
  return [
    `# ${title}`,
    "",
    "## Role",
    "{One line.}",
    "",
    "## Context",
    "- {2-3 bullets.}",
    "",
    "## Interactions",
    "- {YYYY-MM-DD} — {one-line.}",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Render a note (frontmatter + body) for the given type. */
export function renderNote(type: NoteType, fields: RenderFields): string {
  const fm = renderFrontmatter(fields.frontmatter);
  switch (type) {
    case "decision": return fm + renderDecision(fields);
    case "lesson":   return fm + renderLesson(fields);
    case "capture":  return fm + renderCapture(fields);
    case "project":  return fm + renderProject(fields);
    case "daily":    return fm + renderDaily(fields);
    case "person":   return fm + renderPerson(fields);
  }
}

/** Validate a note body (including optional frontmatter block) against its type rules. */
export function validateNote(type: NoteType, body: string): ValidationResult {
  const errors: string[] = [];

  // 1. Required sections
  for (const heading of REQUIRED_SECTIONS[type]) {
    const re = new RegExp(`(^|\\n)${escapeRegex(heading)}(\\n|$)`);
    if (!re.test(body)) {
      errors.push(`missing required section: ${heading}`);
    }
  }

  // 2. Word count (strip frontmatter block and heading lines before counting)
  const stripped = body
    .replace(/^---[\s\S]*?\n---\n?/m, "") // remove frontmatter
    .replace(/^#+ .*$/gm, "");            // remove heading lines
  const wordCount = stripped.split(/\s+/).filter(Boolean).length;
  const ceiling = WORD_CEILINGS[type];
  if (Number.isFinite(ceiling) && wordCount > ceiling) {
    errors.push(`word count ${wordCount} > ceiling ${ceiling}`);
  }

  // 3. Type-specific rules

  if (type === "decision") {
    const alt = extractSection(body, "Alternatives considered");
    if (!/^\s*-\s+\*\*[^*]+\*\*\s*—/m.test(alt)) {
      errors.push(
        "decision: Alternatives considered must contain at least one '- **Name** — reason' bullet"
      );
    }
  }

  if (type === "capture") {
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const titleWords = title.split(/\s+/).filter(Boolean);
    if (titleWords.length > 8 || title.endsWith(".")) {
      errors.push("capture: title must be ≤8 words and not a sentence (no trailing period)");
    }
  }

  if (type === "daily") {
    const linksSec = extractSection(body, "Decisions & gotchas");
    const bulletLines = linksSec.split("\n").filter((l) => l.trimStart().startsWith("- "));
    const bad = bulletLines.filter((l) => !l.trimStart().startsWith("- [[") && l.trim() !== "- _none_");
    if (bad.length > 0) {
      errors.push("daily: 'Decisions & gotchas' contains non-wikilink bullets");
    }
  }

  // Forbid ## See also — edges are frontmatter-driven
  if (/(^|\n)## See also(\n|$)/.test(body)) {
    errors.push("body contains forbidden `## See also` section; edges live in frontmatter (project, created, related, superseded_by)");
  }

  return { valid: errors.length === 0, errors };
}
