export interface InjectOpts {
  verbatim?: boolean;
  distill?: boolean;
  project?: string;
}

export type SanityResult =
  | { ok: true; text: string }
  | { ok: false; code: 2 | 3; reason: string };

const MAX_INPUT_BYTES = 32 * 1024;

export function sanityCheck(raw: string): SanityResult {
  const stripped = raw.replace(/\0/g, "");
  const trimmed = stripped.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: 2, reason: "empty input" };
  }
  if (Buffer.byteLength(stripped, "utf8") > MAX_INPUT_BYTES) {
    return { ok: false, code: 2, reason: "input exceeds 32 KB" };
  }
  if (!/[a-z0-9]/i.test(trimmed)) {
    return { ok: false, code: 2, reason: "no alphanumeric content" };
  }
  return { ok: true, text: stripped };
}

export type Mode = "verbatim" | "distill";

export function detectMode(text: string, opts: InjectOpts): Mode {
  if (opts.verbatim) return "verbatim";
  if (opts.distill) return "distill";
  if (text.length > 200) return "distill";
  if (/\n\s*\n/.test(text)) return "distill";
  return "verbatim";
}
