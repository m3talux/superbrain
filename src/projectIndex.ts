import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { parseNote, serializeNote } from "./frontmatter.js";
import { atomicWrite } from "./atomicWrite.js";

const WALK_EXCLUDE = new Set([".trash", ".obsidian", ".git", "node_modules"]);
const TYPE_ORDER = ["project", "decision", "lesson", "gotcha", "person", "capture"];
const TYPE_PLURAL: Record<string, string> = {
  project: "Projects",
  decision: "Decisions",
  lesson: "Lessons",
  gotcha: "Gotchas",
  person: "People",
  capture: "Captures",
};

function walkVault(dir: string, root: string, acc: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (WALK_EXCLUDE.has(e.name)) continue;
      const rel = path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/");
      if (rel === "maps" || rel === "daily" || rel === "projects/_archive" || rel.startsWith("projects/_archive/")) continue;
      walkVault(path.join(dir, e.name), root, acc);
    } else if (e.name.endsWith(".md")) {
      acc.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/"));
    }
  }
}

export function projectOfNote(relPath: string, fm: Record<string, any>): string | null {
  if (fm.project && typeof fm.project === "string" && fm.project.trim()) {
    return fm.project.trim().toLowerCase();
  }
  const parts = relPath.split("/");
  if (parts[0] === "projects" && parts.length === 2 && !parts[1].startsWith("_")) {
    return parts[1].replace(/\.md$/, "").toLowerCase();
  }
  return null;
}

function extractHook(content: string, fm: Record<string, any>, relPath: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const m = line.match(/^#{1,2}\s+(.+)/);
    if (m) return m[1].trim();
  }
  if (fm.title && typeof fm.title === "string") return fm.title.trim();
  return path.basename(relPath, ".md");
}

export function collectProjectNotes(
  vaultRoot: string,
  slug: string,
): { relPath: string; type: string; hook: string }[] {
  const allPaths: string[] = [];
  walkVault(vaultRoot, vaultRoot, allPaths);

  const indexRelPath = `maps/${slug}-index.md`;
  const results: { relPath: string; type: string; hook: string }[] = [];

  for (const relPath of allPaths) {
    if (relPath === indexRelPath) continue;
    const abs = path.join(vaultRoot, relPath);
    let raw: string;
    try { raw = fs.readFileSync(abs, "utf8"); } catch { continue; }
    const { data: fm, content } = parseNote(raw);
    const proj = projectOfNote(relPath, fm);
    if (proj !== slug) continue;
    const type = typeof fm.type === "string" ? fm.type : "capture";
    const hook = extractHook(content, fm, relPath);
    results.push({ relPath, type, hook });
  }

  return results;
}

export function renderProjectIndexBody(
  slug: string,
  notes: { relPath: string; type: string; hook: string }[],
): string {
  const byType: Record<string, { relPath: string; hook: string }[]> = {};
  for (const n of notes) {
    (byType[n.type] ||= []).push({ relPath: n.relPath, hook: n.hook });
  }
  for (const type of Object.keys(byType)) {
    byType[type].sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  let body = `# ${slug} — index\n\n`;
  for (const type of TYPE_ORDER) {
    const entries = byType[type];
    if (!entries || entries.length === 0) continue;
    const heading = TYPE_PLURAL[type] ?? (type.charAt(0).toUpperCase() + type.slice(1) + "s");
    body += `## ${heading}\n\n`;
    for (const e of entries) {
      const noMd = e.relPath.replace(/\.md$/, "");
      body += `- [[${noMd}]] — ${e.hook}\n`;
    }
    body += "\n";
  }
  return body;
}

export function projectIndexRelPath(slug: string): string {
  return `maps/${slug}-index.md`;
}

export function enumerateProjectSlugs(vaultRoot: string): string[] {
  const slugs = new Set<string>();
  const projectsDir = path.join(vaultRoot, "projects");
  try {
    for (const entry of fs.readdirSync(projectsDir)) {
      if (entry.endsWith(".md") && !entry.startsWith("_")) {
        slugs.add(entry.slice(0, -3).toLowerCase());
      }
    }
  } catch { /* projects dir absent */ }

  const allPaths: string[] = [];
  try { walkVault(vaultRoot, vaultRoot, allPaths); } catch { /* vault absent */ }
  for (const relPath of allPaths) {
    const abs = path.join(vaultRoot, relPath);
    try {
      const raw = fs.readFileSync(abs, "utf8");
      const { data: fm } = parseNote(raw);
      const proj = projectOfNote(relPath, fm);
      if (proj) slugs.add(proj);
    } catch { /* skip unreadable */ }
  }

  return Array.from(slugs).sort();
}

export function buildProjectIndex(slug: string): { relPath: string; changed: boolean } {
  const root = vaultPath();
  const notes = collectProjectNotes(root, slug);
  const body = renderProjectIndexBody(slug, notes);
  const relPath = projectIndexRelPath(slug);
  const abs = path.join(root, relPath);

  let existingBody: string | null = null;
  if (fs.existsSync(abs)) {
    try {
      const raw = fs.readFileSync(abs, "utf8");
      existingBody = parseNote(raw).content;
    } catch { /* treat as missing */ }
  }

  if (existingBody === body) {
    return { relPath, changed: false };
  }

  const today = new Date().toISOString().slice(0, 10);
  const fm: Record<string, any> = {
    type: "map",
    project: slug,
    superbrain: true,
    generated: true,
    created: today,
    updated: today,
  };
  atomicWrite(abs, serializeNote(fm, body));
  return { relPath, changed: true };
}
