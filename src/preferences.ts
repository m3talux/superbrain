import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { parseNote } from "./frontmatter.js";

export function preferencesPath(): string {
  return path.join(vaultPath(), "meta", "preferences.md");
}

export function normalizeBody(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function compileInjectionBlock(): string {
  let raw: string;
  try { raw = fs.readFileSync(preferencesPath(), "utf8"); } catch { return ""; }
  const body = parseNote(raw).content.trim();
  if (!body) return "";
  return `--- Your preferences (SuperBrain) ---\n${body}\n-------------------------------------`;
}
