import fs from "node:fs";
import path from "node:path";

const VAULT_FOLDERS = ["projects", "decisions", "lessons", "capture", "people", "daily", "meta", "maps"];
const FOLDER_PREFERENCE = new Map(VAULT_FOLDERS.map((f, i) => [f, i]));
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

interface Index {
  // Index keys are lowercased so lookup is case-insensitive — Obsidian
  // treats `[[Weddy]]` and `[[weddy]]` as the same target.
  byRelPath: Map<string, string>;
  byBasename: Map<string, string[]>;
  byTokens: Array<{ rel: string; tokens: Set<string>; }>;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function buildIndex(vaultRoot: string): Index {
  const ix: Index = { byRelPath: new Map(), byBasename: new Map(), byTokens: [] };
  for (const folder of VAULT_FOLDERS) {
    const dir = path.join(vaultRoot, folder);
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith(".md")) continue;
      const stem = f.slice(0, -3);
      const rel = `${folder}/${stem}`;
      ix.byRelPath.set(rel.toLowerCase(), rel);
      const stripped = stem.replace(DATE_PREFIX, "");
      for (const key of new Set([stem.toLowerCase(), stripped.toLowerCase()])) {
        const arr = ix.byBasename.get(key) ?? [];
        arr.push(rel);
        ix.byBasename.set(key, arr);
      }
      ix.byTokens.push({ rel, tokens: new Set(tokenize(stripped)) });
    }
  }
  return ix;
}

function normalize(raw: string): string {
  // Strip [[ ]], pipe-alias (`[[target|alias]]` → `target`), .md suffix,
  // leading `./` or `../` (Obsidian wikilinks sometimes carry path prefixes),
  // and a leading slash.
  let s = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const pipe = s.indexOf("|");
  if (pipe >= 0) s = s.slice(0, pipe);
  s = s.trim().replace(/\.md$/i, "");
  while (s.startsWith("../") || s.startsWith("./")) s = s.replace(/^\.\.?\//, "");
  if (s.startsWith("/")) s = s.slice(1);
  return s.trim();
}

function pickPreferred(rels: string[]): string {
  return [...rels].sort((a, b) => {
    const af = a.split("/")[0];
    const bf = b.split("/")[0];
    const ai = FOLDER_PREFERENCE.get(af) ?? 99;
    const bi = FOLDER_PREFERENCE.get(bf) ?? 99;
    return ai - bi;
  })[0];
}

export function resolveLinks(links: string[], vaultRoot: string): string[] {
  if (!links || links.length === 0) return [];
  const ix = buildIndex(vaultRoot);
  if (ix.byRelPath.size === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of links) {
    const link = normalize(raw);
    if (!link) continue;
    const resolved = resolveOne(link, ix);
    if (resolved && !seen.has(resolved)) {
      out.push(resolved);
      seen.add(resolved);
    }
  }
  return out;
}

function resolveOne(link: string, ix: Index): string | null {
  const lower = link.toLowerCase();
  if (link.includes("/")) {
    return ix.byRelPath.get(lower) ?? null;
  }
  const exact = ix.byBasename.get(lower);
  if (exact && exact.length > 0) return pickPreferred(exact);

  const linkTokens = tokenize(link);
  if (linkTokens.length < 2) return null;

  const linkSet = new Set(linkTokens);
  const matches: string[] = [];
  for (const entry of ix.byTokens) {
    let allIn = true;
    for (const t of linkSet) {
      if (!entry.tokens.has(t)) { allIn = false; break; }
    }
    if (allIn) matches.push(entry.rel);
  }
  if (matches.length === 0) return null;
  return pickPreferred(matches);
}
