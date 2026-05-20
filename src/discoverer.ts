import fs from "node:fs";
import path from "node:path";
import { vaultPath, dataDir } from "./paths.js";
import { slug } from "./router.js";
import { acquireLock, releaseLock } from "./lockfile.js";
import { writeFailure } from "./sentinel.js";
import { classifyPath, basenameSlug, hasStrongSignal, isBlockedPath, type Classification, type UmbrellaCtx } from "./projectDetect.js";
import { claudeP } from "./claudeCli.js";

// Discovery: synthesize a substantive `projects/<slug>.md` for a code repo
// the user just opened a session in. The detection cascade lives in
// projectDetect.ts; this module owns the walking, prompt construction,
// claude -p call, file write, and umbrella fan-out.

const MAX_FILES = 600;
const MAX_DEPTH = 5;
const MAX_MANIFEST_BYTES = 8192;
const MAX_SUBPROJECTS_PER_UMBRELLA = 8;

const HEAVY_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", "vendor",
  "__pycache__", ".venv", "venv", ".next", ".nuxt", ".turbo",
  ".cache", ".idea", ".vscode", "coverage", ".pytest_cache",
  ".gradle", ".mvn", "bin", "obj",
]);

const MANIFEST_FILES = [
  "README.md", "README.rst", "README", "README.txt",
  "package.json", "pyproject.toml", "Cargo.toml", "go.mod",
  "requirements.txt", "Gemfile", "composer.json", "pom.xml", "build.gradle",
  "tsconfig.json", "Makefile", "Dockerfile", "docker-compose.yml",
  "CLAUDE.md", ".claude.md", "AGENTS.md", "CONTRIBUTING.md",
  "LICENSE", "LICENSE.md",
];

export function projectSlug(projectDir: string, umbrella?: UmbrellaCtx): string {
  const base = basenameSlug(projectDir);
  return umbrella ? `${umbrella.slug}-${base}` : base;
}

// Slug uniqueness for STANDALONE single-project discovery (no umbrella ctx).
// If the bare basename slug is already taken by a different project_dir, fall
// back to "<parent>-<basename>". Honors the existing note's project_dir
// frontmatter to distinguish "same project re-discovered" from "name clash."
function uniqueStandaloneSlug(projectDir: string): string {
  const base = basenameSlug(projectDir);
  const existing = path.join(vaultPath(), "projects", `${base}.md`);
  if (!fs.existsSync(existing)) return base;
  try {
    const content = fs.readFileSync(existing, "utf8");
    const m = content.match(/^project_dir:\s*"?(.+?)"?\s*$/m);
    // No project_dir field at all → assume legacy/migrated note for the same
    // project. Don't disambiguate; share the slug. Only disambiguate when
    // there's an EXPLICIT, MISMATCHING project_dir — that's the unambiguous
    // "two different real projects collided on basename" case.
    if (!m) return base;
    if (path.resolve(m[1].trim()) === path.resolve(projectDir)) return base;
  } catch { /* ignore */ }
  const parentBase = basenameSlug(path.dirname(projectDir));
  return parentBase ? `${parentBase}-${base}` : base;
}

export function projectNotePath(projectDir: string, umbrella?: UmbrellaCtx): string {
  const s = umbrella ? projectSlug(projectDir, umbrella) : uniqueStandaloneSlug(projectDir);
  return path.join(vaultPath(), "projects", `${s}.md`);
}

export function isUnknownProject(projectDir: string, umbrella?: UmbrellaCtx): boolean {
  try { return !fs.existsSync(projectNotePath(projectDir, umbrella)); }
  catch { return false; }
}

// Re-exported for sb-session-start's old import path (the integration there
// only checks "should we even spawn?"). Both gates are subsumed by
// classifyPath, but keeping these as thin shims minimizes drift.
export function looksLikeCodeProject(projectDir: string): boolean {
  try {
    if (isBlockedPath(projectDir).blocked) return false;
    return hasStrongSignal(projectDir);
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
  umbrella?: UmbrellaCtx;
}

export function buildDiscoveryPrompt(input: BuildPromptInput): string {
  const parts: string[] = [DISCOVERY_PROMPT_PREFIX];
  parts.push(`# Project directory\n\n\`${input.projectDir}\`\n`);
  if (input.umbrella) parts.push(`# Umbrella context\n\nThis project is one sub-project of \`${input.umbrella.dir}\`. Mention it as the parent umbrella in the note's intro paragraph; otherwise treat this sub-project on its own merits.\n`);
  parts.push(`# Manifest files\n`);
  for (const m of input.manifests) parts.push(`## ${m.name}\n\n\`\`\`\n${m.content}\n\`\`\`\n`);
  parts.push(`# Source file paths (${input.paths.length}${input.truncated ? `, TRUNCATED at ${MAX_FILES}` : ""})\n`);
  parts.push("```\n" + input.paths.join("\n") + "\n```\n");
  return parts.join("\n");
}

function callClaudeForDiscovery(prompt: string): string {
  if (process.env.SUPERBRAIN_DISCOVER_STUB) {
    return fs.readFileSync(process.env.SUPERBRAIN_DISCOVER_STUB, "utf8");
  }
  return claudeP(prompt);
}

// Append a single trace line to ~/.superbrain/discovery.log so users (and we)
// can diagnose why discovery did or did not fire for a given path. Never
// fatal — the file is best-effort observability, not load-bearing.
function logTrace(line: string): void {
  try {
    const p = path.join(dataDir(), "discovery.log");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    fs.appendFileSync(p, `[${stamp}] ${line}\n`);
  } catch { /* never propagate */ }
}

interface WriteOptions { projectDir: string; umbrella?: UmbrellaCtx; mode: "create" | "append"; }
async function runDiscoveryWrite(opts: WriteOptions): Promise<void> {
  const { projectDir, umbrella, mode } = opts;
  if (!acquireLock("discover")) { logTrace(`skip ${projectDir}: discover lock held`); return; }
  try {
    const { paths, truncated } = walkBounded(projectDir);
    const manifests = readManifests(projectDir);
    const prompt = buildDiscoveryPrompt({ projectDir, manifests, paths, truncated, umbrella });
    const body = callClaudeForDiscovery(prompt).trim();
    if (!body) {
      writeFailure(`discovery returned empty body for ${projectDir}`);
      logTrace(`fail ${projectDir}: empty body from claude -p`);
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const notePath = projectNotePath(projectDir, umbrella);
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    if (mode === "create") {
      const fm = [
        "---",
        "type: project",
        "status: active",
        `project: ${projectSlug(projectDir, umbrella)}`,
        `project_dir: ${JSON.stringify(projectDir)}`,
        ...(umbrella ? [`umbrella: ${umbrella.slug}`] : []),
        "discovered: true",
        `created: '${date}'`,
        `updated: '${date}'`,
        "superbrain: true",
        "---",
        "",
      ].join("\n");
      fs.writeFileSync(notePath, fm + body + "\n");
      logTrace(`wrote ${notePath} (create${umbrella ? `, umbrella=${umbrella.slug}` : ""})`);
    } else {
      const section = `\n\n## SuperBrain discovery (${date})\n\n${body}\n`;
      fs.appendFileSync(notePath, section);
      logTrace(`appended ${notePath} (force)`);
    }
  } catch (e: any) {
    try { writeFailure(`discovery failed for ${projectDir}: ${e?.message || e}`); } catch { /* noop */ }
    logTrace(`fail ${projectDir}: ${e?.message || e}`);
  } finally {
    releaseLock("discover");
  }
}

// Auto-discovery: fires from sb-session-start on a fresh session opening in
// an unknown project. Routes through the four-stage classifier; "blocked"
// and "skip" outcomes silently write a trace line and return.
export async function runDiscover(cwd: string): Promise<void> {
  if (!cwd || !fs.existsSync(cwd)) { logTrace(`skip: cwd missing or empty`); return; }
  const c = classifyPath(cwd);
  if (c.kind === "blocked") { logTrace(`skip ${cwd}: ${c.reason}`); return; }
  if (c.kind === "skip")    { logTrace(`skip ${cwd}: ${c.reason}`); return; }
  if (c.kind === "single") {
    if (!isUnknownProject(c.projectDir, c.umbrella)) { logTrace(`skip ${c.projectDir}: already has a project note`); return; }
    await runDiscoveryWrite({ projectDir: c.projectDir, umbrella: c.umbrella, mode: "create" });
    return;
  }
  // Umbrella: fan out, one Sonnet call per child, capped.
  const slice = c.children.slice(0, MAX_SUBPROJECTS_PER_UMBRELLA);
  const dropped = c.children.length - slice.length;
  const umbrella: UmbrellaCtx = { dir: c.projectDir, slug: basenameSlug(c.projectDir) };
  logTrace(`umbrella ${c.projectDir} (tool=${c.tool}): ${c.children.length} children, discovering ${slice.length}${dropped ? `, ${dropped} dropped (over cap)` : ""}`);
  for (const child of slice) {
    if (!isUnknownProject(child, umbrella)) { logTrace(`skip umbrella child ${child}: already has a project note`); continue; }
    await runDiscoveryWrite({ projectDir: child, umbrella, mode: "create" });
  }
}

// Force-mode (manual /superbrain:discover). Runs even when a project note
// already exists, in append mode — appends a fresh "## SuperBrain discovery
// (date)" section without clobbering user content. Honors umbrella detection:
// at an umbrella root, fans out to children with the same append semantics.
// `--all` overrides the "only missing children" default at umbrella roots
// (without --all, force at an umbrella root only writes children that lack a
// project note yet).
export async function runDiscoverForce(cwd: string, opts: { all?: boolean } = {}): Promise<void> {
  if (!cwd || !fs.existsSync(cwd)) return;
  const c = classifyPath(cwd);
  if (c.kind === "blocked") { logTrace(`force skip ${cwd}: ${c.reason}`); return; }
  if (c.kind === "skip")    { logTrace(`force skip ${cwd}: ${c.reason}`); return; }
  if (c.kind === "single") {
    const mode = isUnknownProject(c.projectDir, c.umbrella) ? "create" : "append";
    await runDiscoveryWrite({ projectDir: c.projectDir, umbrella: c.umbrella, mode });
    return;
  }
  // Umbrella under force: same fan-out, but per-child mode depends on existence
  // (append if note exists, create if not) — unless --all, which forces append
  // for every child whose note already exists too.
  const slice = c.children.slice(0, MAX_SUBPROJECTS_PER_UMBRELLA);
  const umbrella: UmbrellaCtx = { dir: c.projectDir, slug: basenameSlug(c.projectDir) };
  for (const child of slice) {
    const exists = !isUnknownProject(child, umbrella);
    if (exists && !opts.all) { logTrace(`force skip umbrella child ${child}: note exists (use --all to append)`); continue; }
    const mode = exists ? "append" : "create";
    await runDiscoveryWrite({ projectDir: child, umbrella, mode });
  }
}

export { classifyPath, isBlockedPath };
