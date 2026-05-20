import fs from "node:fs";
import path from "node:path";

// Workspace / monorepo manifest parsers. Each parser inspects a single
// declaration file at a given root and returns the absolute paths of declared
// children, or null if no declaration is present. No external dependencies —
// the module must stay import-safe so the discoverer can load it from
// sb-session-start before bootstrap completes.

// Minimal glob expansion supporting only the patterns actually used by
// workspace manifests: literal paths, single-segment `*`, and double-star
// `**`. Patterns are split on `/`; each `*` segment matches a single
// directory entry; `**` matches any depth. Returns absolute directory paths
// that exist on disk.
function expandGlob(root: string, pattern: string): string[] {
  if (!pattern.includes("*")) {
    const abs = path.resolve(root, pattern);
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? [abs] : [];
  }
  const segments = pattern.split("/").filter(Boolean);
  let frontier: string[] = [path.resolve(root)];
  for (const seg of segments) {
    const next: string[] = [];
    for (const dir of frontier) {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      if (seg === "**") {
        // Match any depth — include dir itself and recurse into every child.
        next.push(dir);
        const stack = entries.filter(e => e.isDirectory() && !e.name.startsWith("."));
        for (const sub of stack) next.push(path.join(dir, sub.name));
      } else if (seg === "*") {
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith(".")) next.push(path.join(dir, e.name));
        }
      } else if (seg.includes("*")) {
        const re = new RegExp("^" + seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
        for (const e of entries) {
          if (e.isDirectory() && re.test(e.name)) next.push(path.join(dir, e.name));
        }
      } else {
        const candidate = path.join(dir, seg);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) next.push(candidate);
      }
    }
    frontier = next;
  }
  return Array.from(new Set(frontier));
}

function applyExcludes(included: string[], excludePatterns: string[], root: string): string[] {
  if (!excludePatterns.length) return included;
  const excluded = new Set<string>();
  for (const e of excludePatterns) for (const p of expandGlob(root, e)) excluded.add(p);
  return included.filter(p => !excluded.has(p));
}

function dedupe(paths: string[]): string[] {
  return Array.from(new Set(paths.map(p => path.resolve(p))));
}

// npm / yarn classic / yarn berry / bun all read `workspaces` from the root
// package.json. yarn classic also accepts `{ packages: [...] }`.
export function parseNpmYarnBunWorkspaces(rootDir: string): string[] | null {
  const pj = path.join(rootDir, "package.json");
  if (!fs.existsSync(pj)) return null;
  let parsed: any;
  try { parsed = JSON.parse(fs.readFileSync(pj, "utf8")); } catch { return null; }
  let patterns: string[] | undefined;
  if (Array.isArray(parsed.workspaces)) patterns = parsed.workspaces;
  else if (parsed.workspaces && Array.isArray(parsed.workspaces.packages)) patterns = parsed.workspaces.packages;
  if (!patterns || !patterns.length) return null;
  const includes = patterns.filter(p => typeof p === "string" && !p.startsWith("!"));
  const excludes = patterns.filter(p => typeof p === "string" && p.startsWith("!")).map(p => p.slice(1));
  const expanded: string[] = [];
  for (const p of includes) expanded.push(...expandGlob(rootDir, p));
  const filtered = applyExcludes(expanded, excludes, rootDir);
  // Each declared workspace MUST itself have a package.json to count.
  return dedupe(filtered).filter(d => fs.existsSync(path.join(d, "package.json")));
}

// pnpm-workspace.yaml at root. We parse just `packages:` + `- ...` lines —
// no general YAML support needed, the file is always this shape.
export function parsePnpmWorkspace(rootDir: string): string[] | null {
  const p = path.join(rootDir, "pnpm-workspace.yaml");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const lines = text.split("\n");
  let inPackages = false;
  const patterns: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "");
    if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
    if (inPackages) {
      // Next top-level key terminates the packages list.
      if (/^[a-zA-Z_-]/.test(line)) { inPackages = false; continue; }
      const m = line.match(/^\s+-\s+["']?([^"'\s]+)["']?\s*$/);
      if (m) patterns.push(m[1]);
    }
  }
  if (!patterns.length) return null;
  const includes = patterns.filter(p => !p.startsWith("!"));
  const excludes = patterns.filter(p => p.startsWith("!")).map(p => p.slice(1));
  const expanded: string[] = [];
  for (const pat of includes) expanded.push(...expandGlob(rootDir, pat));
  const filtered = applyExcludes(expanded, excludes, rootDir);
  return dedupe(filtered).filter(d => fs.existsSync(path.join(d, "package.json")));
}

// Cargo: `[workspace] members = [...]` + optional `exclude = [...]`.
export function parseCargoWorkspace(rootDir: string): string[] | null {
  const p = path.join(rootDir, "Cargo.toml");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  // Find the [workspace] section. Crude but sufficient: scan until next [section].
  const wsStart = text.search(/^\s*\[workspace\]/m);
  if (wsStart < 0) return null;
  let wsEnd = text.indexOf("\n[", wsStart + 1);
  if (wsEnd < 0) wsEnd = text.length;
  const section = text.slice(wsStart, wsEnd);
  function readArray(name: string): string[] {
    const m = section.match(new RegExp(name + "\\s*=\\s*\\[([\\s\\S]*?)\\]"));
    if (!m) return [];
    return [...m[1].matchAll(/["']([^"']+)["']/g)].map(x => x[1]);
  }
  const members = readArray("members");
  if (!members.length) return null;
  const excludes = readArray("exclude");
  const expanded: string[] = [];
  for (const pat of members) expanded.push(...expandGlob(rootDir, pat));
  const filtered = applyExcludes(expanded, excludes, rootDir);
  return dedupe(filtered).filter(d => fs.existsSync(path.join(d, "Cargo.toml")));
}

// go.work: `use ( ./a ./b )` or single `use ./a` lines.
export function parseGoWork(rootDir: string): string[] | null {
  const p = path.join(rootDir, "go.work");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const lines = text.split("\n").map(l => l.replace(/\/\/.*$/, "").trim()).filter(Boolean);
  const paths: string[] = [];
  let inBlock = false;
  for (const ln of lines) {
    if (/^use\s*\(/.test(ln)) { inBlock = true; const rest = ln.replace(/^use\s*\(/, "").trim(); if (rest && rest !== ")") paths.push(rest); continue; }
    if (inBlock) {
      if (ln === ")") { inBlock = false; continue; }
      paths.push(ln);
    } else {
      const m = ln.match(/^use\s+(.+)$/);
      if (m) paths.push(m[1].trim());
    }
  }
  if (!paths.length) return null;
  const abs = paths.map(p => path.resolve(rootDir, p)).filter(d => fs.existsSync(path.join(d, "go.mod")));
  return dedupe(abs);
}

// Maven multi-module: <modules><module>foo</module>...</modules>.
export function parseMavenModules(rootDir: string): string[] | null {
  const p = path.join(rootDir, "pom.xml");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const block = text.match(/<modules>([\s\S]*?)<\/modules>/);
  if (!block) return null;
  const mods = [...block[1].matchAll(/<module>\s*([^<\s][^<]*?)\s*<\/module>/g)].map(m => m[1].trim());
  if (!mods.length) return null;
  const abs = mods.map(m => path.resolve(rootDir, m)).filter(d => fs.existsSync(path.join(d, "pom.xml")));
  return dedupe(abs);
}

// Gradle multi-module: settings.gradle(.kts) with `include 'a', 'b:c'` lines.
// `:a:b` and `a:b` both mean nested dir a/b.
export function parseGradleSettings(rootDir: string): string[] | null {
  for (const fname of ["settings.gradle.kts", "settings.gradle"]) {
    const p = path.join(rootDir, fname);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    const names: string[] = [];
    // include "a", 'b:c'  OR  include("a", "b:c")
    const includeRe = /include\s*\(?([^)\n]+)\)?/g;
    let m: RegExpExecArray | null;
    while ((m = includeRe.exec(text)) !== null) {
      const parts = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
      names.push(...parts);
    }
    if (!names.length) return null;
    const abs = names.map(n => {
      const rel = n.replace(/^:/, "").replace(/:/g, "/");
      return path.resolve(rootDir, rel);
    }).filter(d => fs.existsSync(d));
    return dedupe(abs);
  }
  return null;
}

// Lerna packages — usable only if there's no underlying npm/pnpm workspaces.
// (Modern lerna delegates to package manager workspaces; we prefer those.)
export function parseLernaPackages(rootDir: string): string[] | null {
  const p = path.join(rootDir, "lerna.json");
  if (!fs.existsSync(p)) return null;
  let cfg: any;
  try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
  if (!Array.isArray(cfg.packages)) return null;
  const includes = cfg.packages.filter((p: any) => typeof p === "string" && !p.startsWith("!"));
  const excludes = cfg.packages.filter((p: any) => typeof p === "string" && p.startsWith("!")).map((p: string) => p.slice(1));
  const expanded: string[] = [];
  for (const pat of includes) expanded.push(...expandGlob(rootDir, pat));
  const filtered = applyExcludes(expanded, excludes, rootDir);
  return dedupe(filtered).filter(d => fs.existsSync(path.join(d, "package.json")));
}

// Try each parser in declaration-strength order; first non-empty result wins.
// pnpm explicitly first because its file is unambiguous; npm/yarn second
// because turborepo and lerna delegate to it; then language-native tools.
export function detectWorkspaces(rootDir: string): { tool: string; children: string[] } | null {
  const parsers: Array<[string, (r: string) => string[] | null]> = [
    ["pnpm", parsePnpmWorkspace],
    ["npm/yarn/bun", parseNpmYarnBunWorkspaces],
    ["cargo", parseCargoWorkspace],
    ["go", parseGoWork],
    ["maven", parseMavenModules],
    ["gradle", parseGradleSettings],
    ["lerna", parseLernaPackages],
  ];
  for (const [name, fn] of parsers) {
    try {
      const children = fn(rootDir);
      if (children && children.length > 0) return { tool: name, children };
    } catch { /* try next */ }
  }
  return null;
}
