import fs from "node:fs";
import path from "node:path";

const FRONTMATTER =
  `---\ntype: preference-candidates\nsuperbrain: true\n---\n` +
  `Candidate preferences observed during distillation. Promoted to meta/preferences.md ` +
  `when a rule accumulates ≥3 cross-project imperative observations.\n\n`;

// Words that indicate the rule is an imperative directive rather than an observation.
// "do" alone is too generic; "do not" is accepted via two-word check.
const IMPERATIVE_PREFIXES = ["always", "never", "prefer", "default", "don't", "do not", "avoid", "use"];

export interface Candidate {
  rule: string;
  note?: string;
}

/** Append a candidate to meta/preferences-candidates.md. */
export function appendCandidate(vaultDir: string, c: Candidate): void {
  const file = path.join(vaultDir, "meta", "preferences-candidates.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, FRONTMATTER);
  const stamp = new Date().toISOString();
  const block =
    `\n## ${stamp}\n**Rule:** ${c.rule}\n` +
    (c.note ? `**Note:** ${c.note}\n` : "");
  fs.appendFileSync(file, block);
}

/**
 * Pure-function check: would this candidate qualify for auto-promotion?
 *
 * Length budget: ≤200 characters total (simpler than counting sentences and
 * avoids ambiguity around abbreviations; 200 chars is ~2 short sentences).
 */
export function isPromotable(candidate: { rule: string }, count: number): boolean {
  if (count < 3) return false;

  const rule = candidate.rule.trim();

  // Length budget: ≤200 chars
  if (rule.length > 200) return false;

  // Imperative check — first word or first two words must be in the allow-list
  const words = rule.toLowerCase().split(/\s+/);
  const firstWord = words[0];
  const firstTwo = words.slice(0, 2).join(" ");
  if (!IMPERATIVE_PREFIXES.some(p => firstWord === p || firstTwo === p)) return false;

  // Reject project-scoped: "for <name>: ..."
  if (/^for [\w-]+:/i.test(rule)) return false;

  // Reject stack/tool-scoped: "when writing <X>" or "when using <X>"
  if (/^when\s+\w+\s+\w/i.test(rule)) return false;

  return true;
}

/** Lowercase + strip trailing punctuation/whitespace for grouping. */
function normalize(rule: string): string {
  return rule.trim().toLowerCase().replace(/[.\s]+$/, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inspect candidates file and core preferences file; auto-promote qualifying
 * candidates (≥3 observations, imperative, cross-project) into core.
 * Returns the list of promoted rule strings.
 */
export function autoPromoteCandidates(vaultDir: string): string[] {
  const candFile = path.join(vaultDir, "meta", "preferences-candidates.md");
  const coreFile = path.join(vaultDir, "meta", "preferences.md");
  if (!fs.existsSync(candFile)) return [];

  const text = fs.readFileSync(candFile, "utf8");

  // Parse all **Rule:** occurrences
  const ruleRegex = /^\*\*Rule:\*\*\s*(.+)$/gm;
  const rules: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = ruleRegex.exec(text)) !== null) rules.push(m[1].trim());

  // Group by normalized form, track display text and count
  const counts = new Map<string, { display: string; count: number }>();
  for (const r of rules) {
    const key = normalize(r);
    const entry = counts.get(key) ?? { display: r, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }

  const promoted: string[] = [];

  for (const [, entry] of counts) {
    if (!isPromotable({ rule: entry.display }, entry.count)) continue;
    promoted.push(entry.display);

    // Append to core preferences
    if (fs.existsSync(coreFile)) {
      const core = fs.readFileSync(coreFile, "utf8");
      const heading = `## Auto-promoted: ${entry.display}`;
      if (!core.includes(heading)) {
        fs.appendFileSync(
          coreFile,
          `\n${heading}\n(Auto-promoted from candidates after ${entry.count} observations.)\n`
        );
      }
    }
  }

  if (promoted.length === 0) return [];

  // Remove promoted rules' blocks from the candidates file
  let updated = text;
  for (const display of promoted) {
    const ruleEscaped = escapeRegex(display).replace(/\s+/g, "\\s+");
    // Match "\n## <timestamp>\n**Rule:** <rule>\n(**Note:** ...\n)?"
    // Timestamp is any non-whitespace sequence (ISO or similar)
    const blockRegex = new RegExp(
      `\\n## \\S+\\n\\*\\*Rule:\\*\\*\\s*${ruleEscaped}\\s*\\n(\\*\\*Note:\\*\\*[^\\n]*\\n)?`,
      "gi"
    );
    updated = updated.replace(blockRegex, "");
  }
  if (updated !== text) fs.writeFileSync(candFile, updated);

  return promoted;
}
