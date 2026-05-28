export type Kind = "decision" | "project_fact" | "person" | "gotcha" | "capture" | "lesson" | "preference" | "daily";

// DistilledItem carries either freeform `body` (capture, person, simple cases)
// OR structured per-kind sections (decision/lesson/gotcha). When structured
// fields are present, the router assembles them into the canonical ADR/lesson
// template. When absent, it falls back to `body`. New fields are all optional
// so older distiller outputs (fixtures, stubs) keep routing correctly.
export interface DistilledItem {
  kind: Kind;
  title: string;
  date: string;
  links: string[];
  project?: string;
  person?: string;
  rule?: string;

  // Structured sections used for substantive notes:
  context?: string;        // decision/gotcha — what was happening (legacy)
  decision?: string;       // decision — what was decided
  rationale?: string;      // decision — why this over alternatives (legacy)
  why?: string;            // decision/lesson — constraint/reasoning
  alternatives?: string;   // decision — discarded options and reasons
  consequences?: string;   // decision — trade-offs, what this enables/precludes
  implementation?: string; // decision — concrete next steps or changes made (legacy)
  symptom?: string;        // gotcha — observable failure
  rootCause?: string;      // gotcha — technical explanation
  fix?: string;            // gotcha — what resolves it
  prevention?: string;     // gotcha — how to avoid hitting it again
  whenApplies?: string;    // lesson — when to invoke the rule

  // Structured capture sections (preferred). When present, router renders
  // ## What / ## Why it matters directly. Falls back to freeform `body`.
  what?: string;          // capture — the observed fact or item
  whyItMatters?: string;  // capture — why it is worth keeping

  // Freeform fallback. Used for captures and as a back-compat slot when the
  // model returns the old single-blob shape.
  body?: string;
}

export interface RouteResult {
  relPath: string;
  frontmatter: Record<string, any>;
  body: string;
  mode: "create" | "append" | "replace";
}

export function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}
function withLinks(body: string, links: string[]): string {
  const wl = links.filter(Boolean).map((l) => `[[${l}]]`);
  return wl.length ? `${body}\n\nRelated: ${wl.join(" ")}` : body;
}

// Helper: emit "## Heading\n\ncontent" only when content is non-empty. Lets the
// router omit sections the distiller chose not to fill.
function section(heading: string, content: string | undefined): string {
  const v = (content || "").trim();
  return v ? `## ${heading}\n\n${v}` : "";
}
function joinSections(parts: string[]): string {
  return parts.filter(Boolean).join("\n\n");
}

export function route(item: DistilledItem): RouteResult {
  const base = { created: item.date, updated: item.date, superbrain: true };
  switch (item.kind) {
    case "decision": {
      const structured = joinSections([
        section("Decision", item.decision),
        section("Why", item.why || item.rationale),
        section("Alternatives considered", item.alternatives),
        section("Consequences", item.consequences),
      ]);
      const inner = structured || (item.body || "").trim();
      return {
        relPath: `decisions/${item.date}-${slug(item.title)}.md`,
        frontmatter: { type: "decision", status: "active", ...(item.project ? { project: slug(item.project) } : {}), ...base },
        body: withLinks(`# ${item.date} — ${item.title}\n\n${inner}`, item.links),
        mode: "create",
      };
    }
    case "project_fact":
      return {
        relPath: `projects/${slug(item.project || "unknown")}.md`,
        frontmatter: { type: "project", status: "active", project: slug(item.project || "unknown"), ...base },
        body: withLinks(`**${item.title}** — ${(item.body || "").trim()}`, item.links),
        mode: "append",
      };
    case "person":
      return {
        relPath: `people/${slug(item.person || "unknown")}.md`,
        frontmatter: { type: "person", status: "active", ...base },
        body: withLinks((item.body || "").trim(), item.links),
        mode: "append",
      };
    case "gotcha": {
      const structured = joinSections([
        section("Symptom", item.symptom),
        section("Root cause", item.rootCause),
        section("Fix", item.fix),
        section("Prevention", item.prevention),
      ]);
      const inner = structured || (item.body || "").trim();
      return {
        relPath: `projects/${slug(item.project || "unknown")}.md`,
        frontmatter: { type: "project", status: "active", project: slug(item.project || "unknown"), ...base },
        body: withLinks(`## Gotcha — ${item.title}\n\n${inner}`, item.links),
        mode: "append",
      };
    }
    case "lesson": {
      // "Structured" means the distiller filled one of the NEW lesson sections
      // (why / whenApplies). The legacy shape is { body, rule } — that path
      // must keep producing `**Why:** body` + `**Rule:** rule` for back-compat
      // with existing fixtures and any in-flight ndjson stubs.
      const hasStructured = !!((item.why || "").trim() || (item.whenApplies || "").trim());
      let inner: string;
      if (hasStructured) {
        inner = joinSections([
          section("Rule", item.rule),
          section("Why", item.why),
          section("When this applies", item.whenApplies),
        ]);
      } else {
        const why = item.body ? `**Why:** ${item.body.trim()}` : "";
        const ruleLine = item.rule ? `\n\n**Rule:** ${item.rule}` : "";
        inner = `${why}${ruleLine}`.trim();
      }
      return {
        relPath: `lessons/${item.date}-${slug(item.title)}.md`,
        frontmatter: { type: "lesson", status: "active", ...base },
        body: withLinks(`# ${item.title}\n\n${inner}`, item.links),
        mode: "create",
      };
    }
    case "preference":
      return {
        relPath: `meta/preferences.md`,
        frontmatter: { type: "preference", ...base },
        body: (item.body || "").trim(),
        mode: "replace",
      };
    case "daily":
      return {
        relPath: `daily/${item.date}.md`,
        frontmatter: { type: "daily", ...base },
        body: withLinks((item.body || "").trim(), item.links),
        mode: "append",
      };
    default: {
      // Re-route capture items whose title matches `daily-YYYY-MM-DD` — these
      // are daily notes that were mis-classified as captures.
      const dailyTitle = (item.title || "").match(/^daily-(\d{4}-\d{2}-\d{2})$/);
      if (dailyTitle) {
        return {
          relPath: `daily/${dailyTitle[1]}.md`,
          frontmatter: { type: "daily", ...base },
          body: withLinks((item.body || "").trim(), item.links),
          mode: "append",
        };
      }
      {
        const hasStructured = !!((item.what || "").trim() || (item.whyItMatters || "").trim());
        let captureBody: string;
        if (hasStructured) {
          captureBody = joinSections([
            `# ${item.title}`,
            section("What", item.what),
            section("Why it matters", item.whyItMatters),
          ]);
        } else {
          captureBody = `# ${item.title}\n\n${(item.body || "").trim()}`;
        }
        return {
          relPath: `capture/${item.date}-${slug(item.title)}.md`,
          frontmatter: { type: "capture", status: "active", tags: ["triage"], ...base },
          body: withLinks(captureBody, item.links),
          mode: "create",
        };
      }
    }
  }
}
