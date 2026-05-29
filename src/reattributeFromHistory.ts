import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { parseNote, serializeNote } from "./frontmatter.js";
import { classifyPath, basenameSlug } from "./projectDetect.js";

export interface ReattributionFix {
  relPath: string;
  absPath: string;
  oldProject: string | undefined;
  newProject: string;
}

export interface ReattributionPlan {
  fixes: ReattributionFix[];
}

const SKIP_DIRS = new Set([".trash", ".obsidian", ".git", "node_modules"]);

function walkVault(vaultDir: string): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.join(dir, entry.name));
      }
    }
  }
  walk(vaultDir);
  return files;
}

function knownProjectSlugs(vaultDir: string): Set<string> {
  const projectsDir = path.join(vaultDir, "projects");
  const slugs = new Set<string>();
  if (!fs.existsSync(projectsDir)) return slugs;
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      slugs.add(path.basename(entry.name, ".md"));
    }
  }
  return slugs;
}

const VALID_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function isJunkProject(project: string | undefined, validSlugs: Set<string>): boolean {
  if (project === undefined || project === null || project === "") return true;
  if (project === "global") return false;
  if (project.includes("/") || project.includes(",")) return true;
  if (validSlugs.has(project)) return false;
  if (VALID_SLUG_RE.test(project)) return false;
  return true;
}

function resolveProjectFromSessions(
  sessionIds: string[],
  sessionsDir: string,
): string | undefined {
  const countBySlug: Map<string, number> = new Map();
  for (const sid of sessionIds) {
    const ndjsonPath = path.join(sessionsDir, `${sid}.ndjson`);
    if (!fs.existsSync(ndjsonPath)) continue;
    let raw: string;
    try { raw = fs.readFileSync(ndjsonPath, "utf8"); } catch { continue; }
    for (const line of raw.split("\n").filter(Boolean)) {
      let event: any;
      try { event = JSON.parse(line); } catch { continue; }
      const cwd = event?.cwd;
      if (!cwd || typeof cwd !== "string") continue;
      const c = classifyPath(cwd);
      if (c.kind === "blocked" || c.kind === "skip") continue;
      const s = basenameSlug(c.projectDir);
      countBySlug.set(s, (countBySlug.get(s) ?? 0) + 1);
    }
  }
  if (countBySlug.size === 0) return undefined;
  let dominant: string | undefined;
  let max = 0;
  for (const [s, count] of countBySlug) {
    if (count > max) { dominant = s; max = count; }
  }
  return dominant;
}

export function planReattribution(dataDir: string): ReattributionPlan {
  const vault = vaultPath();
  const dailyDir = path.join(dataDir, "daily");
  const sessionsDir = path.join(dataDir, "sessions");

  const noteToSessions: Map<string, string[]> = new Map();

  if (fs.existsSync(dailyDir)) {
    for (const entry of fs.readdirSync(dailyDir)) {
      if (!entry.endsWith(".json")) continue;
      let state: Record<string, { routedRelPaths?: string[] }>;
      try {
        state = JSON.parse(fs.readFileSync(path.join(dailyDir, entry), "utf8"));
      } catch { continue; }
      for (const [sid, dayEntry] of Object.entries(state)) {
        for (const relPath of dayEntry?.routedRelPaths ?? []) {
          const existing = noteToSessions.get(relPath) ?? [];
          existing.push(sid);
          noteToSessions.set(relPath, existing);
        }
      }
    }
  }

  const validSlugs = knownProjectSlugs(vault);
  const fixes: ReattributionFix[] = [];

  if (!fs.existsSync(vault)) return { fixes };

  for (const absPath of walkVault(vault)) {
    const relPath = path.relative(vault, absPath).replace(/\\/g, "/");
    let raw: string;
    try { raw = fs.readFileSync(absPath, "utf8"); } catch { continue; }
    const { data } = parseNote(raw);
    const project = typeof data.project === "string" ? data.project : undefined;
    if (!isJunkProject(project, validSlugs)) continue;

    const sessionIds = noteToSessions.get(relPath) ?? [];
    if (sessionIds.length === 0) continue;

    const newProject = resolveProjectFromSessions(sessionIds, sessionsDir);
    if (!newProject) continue;

    fixes.push({ relPath, absPath, oldProject: project, newProject });
  }

  return { fixes };
}

export function applyReattribution(plan: ReattributionPlan): void {
  for (const fix of plan.fixes) {
    let raw: string;
    try { raw = fs.readFileSync(fix.absPath, "utf8"); } catch { continue; }
    const { data, content } = parseNote(raw);
    data.project = fix.newProject;
    const newRaw = serializeNote(data, content);
    try { fs.writeFileSync(fix.absPath, newRaw, "utf8"); } catch { /* best-effort */ }
  }
}
