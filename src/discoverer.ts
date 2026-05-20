import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { vaultPath } from "./paths.js";
import { slug } from "./router.js";
import { acquireLock, releaseLock } from "./lockfile.js";
import { writeFailure } from "./sentinel.js";
import { distillModel } from "./model.js";

// Discovery: on a session opening in a project we've never seen before,
// produce ~/.superbrain/vault/projects/<slug>.md with a substantive code map
// the next session can read. One Sonnet call per project, ever. After that
// the note is "known" (its existence is the gate) and further distillation
// only appends to it via the normal router path.

// Directories the walk always skips. Heavy, vendored, or build output —
// adding them to the prompt context would just blow the token budget.
const HEAVY_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", "vendor",
  "__pycache__", ".venv", "venv", ".next", ".nuxt", ".turbo",
  ".cache", ".idea", ".vscode", "coverage", ".pytest_cache",
  ".gradle", ".mvn", "bin", "obj",
]);

// Hard caps so a giant repo never spirals.
const MAX_FILES = 600;
const MAX_DEPTH = 5;
const MAX_MANIFEST_BYTES = 8192;

// Files read in full to anchor the discovery prompt context.
const MANIFEST_FILES = [
  "README.md", "README.rst", "README", "README.txt",
  "package.json", "pyproject.toml", "Cargo.toml", "go.mod",
  "requirements.txt", "Gemfile", "composer.json", "pom.xml", "build.gradle",
  "tsconfig.json", "Makefile", "Dockerfile", "docker-compose.yml",
  "CLAUDE.md", ".claude.md", "AGENTS.md", "CONTRIBUTING.md",
  "LICENSE", "LICENSE.md",
];

export function projectSlug(projectDir: string): string {
  return slug(path.basename(projectDir));
}

export function projectNotePath(projectDir: string): string {
  return path.join(vaultPath(), "projects", `${projectSlug(projectDir)}.md`);
}

// "Unknown" = no project note exists yet. Once discovery (or any distillation)
// has produced the file, we never re-discover — that protects user edits and
// avoids ever burning tokens twice on the same project.
export function isUnknownProject(projectDir: string): boolean {
  try { return !fs.existsSync(projectNotePath(projectDir)); }
  catch { return false; }
}

// Heuristic gate: don't trigger discovery on directories that aren't actually
// code projects (the user's home, a random tmp dir, etc.).
export function looksLikeCodeProject(projectDir: string): boolean {
  try {
    if (fs.existsSync(path.join(projectDir, ".git"))) return true;
    for (const name of MANIFEST_FILES) {
      if (fs.existsSync(path.join(projectDir, name))) return true;
    }
    return false;
  } catch { return false; }
}

interface WalkResult { paths: string[]; truncated: boolean; }
function walkBounded(root: string): WalkResult {
  const out: string[] = [];
  let truncated = false;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length) {
    if (out.length >= MAX_FILES) { truncated = true; break; }
    const { dir, depth } = queue.shift()!;
    if (depth > MAX_DEPTH) continue;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      // Skip hidden entries except .github (workflows are signal).
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      if (HEAVY_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        queue.push({ dir: full, depth: depth + 1 });
      } else if (e.isFile()) {
        out.push(path.relative(root, full));
        if (out.length >= MAX_FILES) { truncated = true; break; }
      }
    }
  }
  return { paths: out, truncated };
}

interface Manifest { name: string; content: string; }
function readManifests(root: string): Manifest[] {
  const out: Manifest[] = [];
  for (const name of MANIFEST_FILES) {
    const p = path.join(root, name);
    try {
      const stat = fs.statSync(p);
      if (!stat.isFile()) continue;
      const raw = fs.readFileSync(p, "utf8");
      out.push({ name, content: raw.slice(0, MAX_MANIFEST_BYTES) });
    } catch { /* absent — skip */ }
  }
  return out;
}

const DISCOVERY_PROMPT_PREFIX = `You are SuperBrain's project discoverer. You receive a project's manifest files (README, package manifests, CLAUDE.md, Dockerfile, etc.) and a bounded list of source-file paths under it. Produce a substantive project note that a future Claude Code session would read to bootstrap context.

# Hard rules

1. Output ONLY the markdown body of the project note — no prose around it, no backticks fencing the entire output.
2. Start with the project name as an H1, then the sections below in order.
3. Be specific. Extract claims from the actual manifests and file list, not generic templates. If something is genuinely unknown, write "Unknown" rather than guess.
4. Keep the whole note under 600 lines.

# Required sections (in this exact order)

# <Project name from manifests, or directory name>

> One-sentence elevator description (from README, package description, or inferred from the file list).

## Stack
- Primary language(s).
- Framework(s) / runtime / build system.
- Package manager(s).
- 3–7 load-bearing libraries if visible.

## Architecture
One or two paragraphs describing the architectural pattern (monolith, microservices, library, CLI, framework adapter, etc.), the entry point(s), and the dataflow at a high level. Cite specific files where useful.

## Top-level folders
A bullet per top-level folder explaining what lives there and what it owns. Skip vendored/build dirs.

## Key files
3–10 bullets pointing to the most load-bearing files. Format: \`path/to/file.ext\` — one-line purpose.

## Docs
Pointers to documentation that exists in the repo (README, CONTRIBUTING, docs/, design docs). If there is none, write "None at this layer".

## Conventions
Anything visible about the project's conventions: linting, formatting, test runner, CI workflow, commit style, branch model. If unknown, "Unknown".

## Open questions
Things a new contributor would still need to ask. Be concrete — not "what does it do" but "what is the relationship between X and Y" or "is Z deprecated in favor of W".

`;

interface BuildPromptInput {
  projectDir: string;
  manifests: Manifest[];
  paths: string[];
  truncated: boolean;
}

export function buildDiscoveryPrompt(input: BuildPromptInput): string {
  const parts: string[] = [DISCOVERY_PROMPT_PREFIX];
  parts.push(`# Project directory\n\n\`${input.projectDir}\`\n`);
  parts.push(`# Manifest files\n`);
  for (const m of input.manifests) {
    parts.push(`## ${m.name}\n\n\`\`\`\n${m.content}\n\`\`\`\n`);
  }
  parts.push(`# Source file paths (${input.paths.length}${input.truncated ? `, TRUNCATED at ${MAX_FILES}` : ""})\n`);
  parts.push("```\n" + input.paths.join("\n") + "\n```\n");
  return parts.join("\n");
}

function callClaudeForDiscovery(prompt: string): string {
  if (process.env.SUPERBRAIN_DISCOVER_STUB) {
    return fs.readFileSync(process.env.SUPERBRAIN_DISCOVER_STUB, "utf8");
  }
  return execFileSync("claude", ["--model", distillModel(), "-p", prompt], { encoding: "utf8" });
}

// Auto-discovery: fires from sb-session-start the first time a session opens
// in a project with no existing note. Never overwrites — `isUnknownProject`
// gate skips any project that already has a `projects/<slug>.md`. To force
// discovery on a project that already has a note (e.g. one migrated from a
// legacy vault with no real content), use `runDiscoverForce` via the
// /superbrain:discover slash command.
export async function runDiscover(projectDir: string): Promise<void> {
  if (!projectDir || !fs.existsSync(projectDir)) return;
  if (!looksLikeCodeProject(projectDir)) return;
  if (!isUnknownProject(projectDir)) return;
  return runDiscoveryWrite(projectDir, "create");
}

// Forced discovery: runs even if a project note already exists. In that case
// the synthesized body is appended under a `## SuperBrain discovery (date)`
// heading rather than replacing the file, so user-authored content is never
// clobbered. Used by `/superbrain:discover` for manual re-discovery on
// migrated stubs and for explicit refreshes.
export async function runDiscoverForce(projectDir: string): Promise<void> {
  if (!projectDir || !fs.existsSync(projectDir)) return;
  if (!looksLikeCodeProject(projectDir)) return;
  const mode = isUnknownProject(projectDir) ? "create" : "append";
  return runDiscoveryWrite(projectDir, mode);
}

async function runDiscoveryWrite(projectDir: string, mode: "create" | "append"): Promise<void> {
  if (!acquireLock("discover")) return;
  try {
    const { paths, truncated } = walkBounded(projectDir);
    const manifests = readManifests(projectDir);
    const prompt = buildDiscoveryPrompt({ projectDir, manifests, paths, truncated });
    const body = callClaudeForDiscovery(prompt).trim();
    if (!body) {
      writeFailure(`discovery returned empty body for ${projectDir}`);
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const notePath = projectNotePath(projectDir);
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    if (mode === "create") {
      const frontmatter = [
        "---",
        "type: project",
        "status: active",
        `project: ${projectSlug(projectDir)}`,
        `project_dir: ${JSON.stringify(projectDir)}`,
        "discovered: true",
        `created: '${date}'`,
        `updated: '${date}'`,
        "superbrain: true",
        "---",
        "",
      ].join("\n");
      fs.writeFileSync(notePath, frontmatter + body + "\n");
    } else {
      // Append-only: never clobber user-authored content, never reorder
      // existing sections, just stamp a fresh discovery block at the bottom.
      const section = `\n\n## SuperBrain discovery (${date})\n\n${body}\n`;
      fs.appendFileSync(notePath, section);
    }
  } catch (e: any) {
    try { writeFailure(`discovery failed for ${projectDir}: ${e?.message || e}`); } catch { /* noop */ }
  } finally {
    releaseLock("discover");
  }
}
