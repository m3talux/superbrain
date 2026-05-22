import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { parseNote } from "./frontmatter.js";
import { truncateToBudget, INJECT_LIMITS } from "./injectBudget.js";

const CAP_BYTES = 3072;
const SENTINEL = "\n[…truncated; see meta/preferences.md]\n";

export function capPreferences(content: string): string {
  // Token cap (logical truth): apply first so the channel never exceeds its
  // allotted token budget regardless of encoding. The byte cap below acts as
  // belt-and-braces for multibyte / ASCII-heavy content where bytes > chars.
  // Both caps apply independently; whichever fires (or both) appends the sentinel.
  let truncated = false;

  const tokenCapped = truncateToBudget(content, INJECT_LIMITS.preferences);
  if (tokenCapped.length < content.length) {
    content = tokenCapped;
    truncated = true;
  }

  if (Buffer.byteLength(content, "utf8") > CAP_BYTES) {
    const sentinelBytes = Buffer.byteLength(SENTINEL, "utf8");
    const budget = CAP_BYTES - sentinelBytes;
    let out = content;
    while (Buffer.byteLength(out, "utf8") > budget) {
      out = out.slice(0, -1);
    }
    return out + SENTINEL;
  }

  return truncated ? content + SENTINEL : content;
}

export function preferencesPath(): string {
  return path.join(vaultPath(), "meta", "preferences.md");
}

export function compileInjectionBlock(): string {
  let raw: string;
  try { raw = fs.readFileSync(preferencesPath(), "utf8"); } catch { return ""; }
  const body = capPreferences(parseNote(raw).content.trim());
  if (!body) return "";
  return `--- Your preferences (SuperBrain) ---\n${body}\n-------------------------------------`;
}
