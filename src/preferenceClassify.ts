// Content-based classifier for preference scope.
// Conservative by design: default to 'universal'. A rule demotes to project
// scope ONLY when it explicitly names a REAL EXISTING project slug:
//   1. Explicit for-<slug>: prefix AND the slug is in the known-slugs set.
//   2. Inline context qualifier ("in <slug>,", "when working on <slug>")
//      AND the slug is in the known-slugs set.
// A single common English word after "In" or "when working on" is ALWAYS
// universal when it is not a known project slug.
// A false positive (silently demoting a genuinely universal rule) is worse
// than a false negative. When uncertain, keep as universal.

export interface ScopeResult {
  scope: "universal" | "project";
  projectSlug?: string;
}

export interface DemotedEntry {
  text: string;
  projectSlug?: string;
}

export interface FilterResult {
  universalBody: string;
  demoted: DemotedEntry[];
}

// Patterns for signal 2: inline project-name context qualifiers.
// The slug must immediately follow the qualifying phrase.
const INLINE_PROJECT_PATTERNS = [
  /\bin\s+([\w-]+)\s*,/i,
  /\bfor the\s+([\w-]+)\s+codebase\b/i,
  /\bwhen working on\s+([\w-]+)\s*[,\s]/i,
  /\bin the\s+([\w-]+)\s+(?:project|codebase|repo|repository)\b/i,
];

/**
 * Classify a single rule text as "universal" or "project".
 * Pure function, no I/O, no LLM call.
 *
 * @param text - the rule text to classify
 * @param knownSlugs - basenames of existing projects/*.md files (lowercased).
 *   A rule is demoted to project scope ONLY when the candidate token appears
 *   in this set. When the set is empty or the candidate is not present, the
 *   rule stays universal.
 */
export function classifyPreferenceScope(
  text: string,
  knownSlugs: ReadonlySet<string> = new Set(),
): ScopeResult {
  const trimmed = text.trim();

  // Signal 1: explicit "for <slug>: ..." prefix.
  const signal1 = trimmed.match(/^for\s+([\w-]+)\s*:/i);
  if (signal1) {
    const candidate = signal1[1].toLowerCase();
    if (knownSlugs.has(candidate)) {
      return { scope: "project", projectSlug: candidate };
    }
    return { scope: "universal" };
  }

  // Signal 2: inline project-name mention in a context-qualifying phrase.
  for (const pat of INLINE_PROJECT_PATTERNS) {
    const m = trimmed.match(pat);
    if (m) {
      const candidate = m[1].toLowerCase();
      if (knownSlugs.has(candidate)) {
        return { scope: "project", projectSlug: candidate };
      }
      // Candidate not a known slug — fall through to universal
    }
  }

  // Default: universal. Technology-stack names, conditional imperatives,
  // past-tense narratives, common English words, and anything else all
  // stay universal when not matched to a known project slug.
  return { scope: "universal" };
}

/**
 * Strip project-scoped rules from a full preferences doc body.
 * Preserves "## Category" headings (drops empty categories).
 * Non-bullet prose lines under kept headings are preserved as universal.
 * Returns the filtered universal body and the list of demoted entries.
 *
 * The input may contain YAML frontmatter (--- ... ---), which is preserved
 * verbatim in the output universalBody.
 *
 * @param body - the full preferences document text
 * @param knownSlugs - basenames of existing projects/*.md files (lowercased).
 */
export function filterToUniversal(
  body: string,
  knownSlugs: ReadonlySet<string> = new Set(),
): FilterResult {
  const demoted: DemotedEntry[] = [];

  // Split off frontmatter
  const fmMatch = body.match(/^(---[\s\S]*?---\s*\n?)/);
  const frontmatter = fmMatch ? fmMatch[1] : "";
  const content = fmMatch ? body.slice(fmMatch[0].length) : body;

  // Parse the content into sections keyed by heading.
  const lines = content.split("\n");

  interface Section {
    heading: string | null;
    bullets: string[];
    kept: string[];
    prose: string[];     // non-bullet prose lines in order (raw lines)
    isBulletCategory: boolean;
  }

  const sections: Section[] = [];
  let current: Section = { heading: null, bullets: [], kept: [], prose: [], isBulletCategory: false };
  sections.push(current);

  for (const line of lines) {
    if (line.startsWith("## ")) {
      current = { heading: line.slice(3).trim(), bullets: [], kept: [], prose: [], isBulletCategory: false };
      sections.push(current);
      continue;
    }
    if (line.match(/^- /)) {
      current.isBulletCategory = true;
      const bulletText = line.slice(2).trim();
      if (bulletText) {
        current.bullets.push(bulletText);
        const r = classifyPreferenceScope(bulletText, knownSlugs);
        if (r.scope === "project") {
          demoted.push({ text: bulletText, projectSlug: r.projectSlug });
        } else {
          current.kept.push(bulletText);
        }
      }
      continue;
    }
    // Non-bullet lines (prose paragraphs, blank lines).
    // For the preamble (heading === null) they go into kept for reconstruction.
    // For named sections they go into prose so we can re-emit them when the
    // section has kept bullets OR when the section has no bullets at all.
    if (current.heading === null) {
      current.kept.push(line);
    } else {
      current.prose.push(line);
    }
  }

  // Reconstruct the filtered body.
  const outputParts: string[] = [];

  for (const sec of sections) {
    if (sec.heading === null) {
      // Preamble: output as-is
      const preamble = sec.kept.join("\n");
      if (preamble.trim()) outputParts.push(preamble);
      continue;
    }

    if (sec.isBulletCategory) {
      if (sec.kept.length > 0) {
        // Emit heading + any prose intro + kept bullets
        const prosePart = sec.prose.join("\n");
        const bulletLines = sec.kept.map(b => `- ${b}`).join("\n");
        const inner = prosePart.trim()
          ? `${prosePart.trimEnd()}\n\n${bulletLines}`
          : bulletLines;
        outputParts.push(`## ${sec.heading}\n\n${inner}`);
      }
      // Otherwise drop the empty category (all bullets were project-scoped)
    } else {
      // No bullets: classify the heading text itself, and preserve any prose.
      // Prose-only sections are universal by default.
      const r = classifyPreferenceScope(sec.heading, knownSlugs);
      if (r.scope === "project") {
        demoted.push({ text: sec.heading, projectSlug: r.projectSlug });
      } else {
        const prosePart = sec.prose.join("\n");
        const inner = prosePart.trim() ? `\n\n${prosePart.trimEnd()}` : "";
        outputParts.push(`## ${sec.heading}${inner}`);
      }
    }
  }

  const reconstructed = outputParts.join("\n\n");
  const universalBody = frontmatter + (reconstructed ? reconstructed + "\n" : "");

  return { universalBody, demoted };
}
