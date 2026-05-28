import { NoteType, validateNote } from "./templates.js";

export interface Candidate {
  proposedType: NoteType;
  title: string;
  body: string;
}

export interface ClassificationResult {
  accepted: boolean;
  reason?: string;
  suggestedType?: NoteType;
}

const REROUTE_TO_CAPTURE = new Set(["shipped", "released", "deployed", "merged"]);
const REROUTE_TO_LESSON = new Set(["learned", "always", "never"]);

const PROJECT_REQUIRED: NoteType[] = ["project"];

export function classify(c: Candidate): ClassificationResult {
  // 1. Title-prefix reroute (decisions only)
  const firstWord = c.title.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (c.proposedType === "decision") {
    if (REROUTE_TO_CAPTURE.has(firstWord)) {
      return { accepted: false, reason: `title prefix '${firstWord}' belongs in capture`, suggestedType: "capture" };
    }
    if (REROUTE_TO_LESSON.has(firstWord)) {
      return { accepted: false, reason: `title prefix '${firstWord}' belongs in lesson`, suggestedType: "lesson" };
    }
  }

  // 2. Template validation
  const v = validateNote(c.proposedType, c.body);
  if (!v.valid) return { accepted: false, reason: v.errors.join("; ") };

  // 3. Project requirement
  if (PROJECT_REQUIRED.includes(c.proposedType)) {
    const fmBlock = c.body.match(/^---\n([\s\S]*?)\n---/);
    const fmText = fmBlock ? fmBlock[1] : "";
    if (!/^project:\s*\S+/m.test(fmText)) {
      return { accepted: false, reason: "frontmatter missing required: project" };
    }
  }

  return { accepted: true };
}
