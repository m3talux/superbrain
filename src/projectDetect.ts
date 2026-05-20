import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectWorkspaces } from "./workspaces.js";

// Project classification: a four-stage cascade that decides what (if
// anything) discovery should do for a given session cwd. Pure file-system
// inspection — no LLM calls, no network. Designed to return in <50ms.
//
//   Stage 1: path blocklist (HOME, Documents, /tmp, /Library, …)
//   Stage 2: strong-signal check (real manifests, not just README/LICENSE)
//   Stage 3: explicit workspace declaration (pnpm-workspace.yaml, etc.)
//   Stage 4: implicit umbrella (≥2 sibling subdirs each strong-signal)
//
// Each stage is a hard gate. Failure = stop, no discovery, no Sonnet call.

const STRONG_FILES = [
  ".git", "package.json", "pyproject.toml", "setup.py", "setup.cfg", "Pipfile",
  "go.mod", "go.work", "Cargo.toml", "pom.xml",
  "settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts",
  "Gemfile", "composer.json", "mix.exs", "pubspec.yaml", "Package.swift",
  "Project.toml", "stack.yaml", "cabal.project",
  "flake.nix", "deno.json", "deno.jsonc", "bun.lock", "bun.lockb",
  "pnpm-workspace.yaml", "MODULE.bazel", "WORKSPACE", "WORKSPACE.bazel",
  "CLAUDE.md", ".claude", ".mcp.json", "AGENTS.md",
];

// Suffix-matched strong signals (Xcode bundles, .NET projects, Haskell cabal).
const STRONG_SUFFIXES = [".xcodeproj", ".xcworkspace", ".sln", ".csproj", ".fsproj", ".vbproj", ".cabal"];

export function hasStrongSignal(dir: string): boolean {
  try {
    for (const m of STRONG_FILES) {
      if (fs.existsSync(path.join(dir, m))) return true;
    }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const e of entries) {
      for (const sfx of STRONG_SUFFIXES) if (e.name.endsWith(sfx)) return true;
    }
    return false;
  } catch { return false; }
}

// Directories the implicit-umbrella scan skips. They're never themselves a
// "sub-project" and walking into them costs us nothing useful.
const HEAVY_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", "vendor",
  "__pycache__", ".venv", "venv", ".next", ".nuxt", ".turbo",
  ".cache", ".idea", ".vscode", "coverage", ".pytest_cache",
  ".gradle", ".mvn", "bin", "obj",
]);

function homedir(): string { return os.homedir(); }

// Path classification. Exposed for tests and for the "why was this skipped?"
// trace written to ~/.superbrain/discovery.log. SUPERBRAIN_TEST_BYPASS_BLOCKLIST
// is an internal seam — tests using /tmp paths set it; Claude Code never does.
export function isBlockedPath(p: string): { blocked: boolean; reason?: string } {
  if (process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST === "1") return { blocked: false };
  const HOME = homedir();
  const abs = path.resolve(p);

  // Exact-match blocklist. The literal home dir and standard user folders
  // are never project roots even when they coincidentally contain a stray
  // manifest from an extracted archive.
  const exactBlocked = new Set<string>([
    "/", HOME,
    path.join(HOME, "Desktop"), path.join(HOME, "Documents"),
    path.join(HOME, "Downloads"), path.join(HOME, "Music"),
    path.join(HOME, "Movies"), path.join(HOME, "Videos"),
    path.join(HOME, "Pictures"), path.join(HOME, "Public"),
    path.join(HOME, "Templates"),
    path.join(HOME, "Dropbox"), path.join(HOME, "OneDrive"),
    path.join(HOME, "Google Drive"),
  ]);
  if (exactBlocked.has(abs)) return { blocked: true, reason: `exact-match blocklist: ${abs}` };

  // Cloud-sync providers: block the root, allow nested projects.
  const cloudParent = path.join(HOME, "Library", "CloudStorage");
  if (path.dirname(abs) === cloudParent) return { blocked: true, reason: `cloud-sync root: ${abs}` };

  // Prefix-match blocklist. Anything inside a cache / config / credential /
  // package-manager state tree is system data, not a user project.
  const prefixes: string[] = [
    "/tmp/", "/var/tmp/", "/private/tmp/", "/private/var/folders/",
    "/usr/", "/opt/", "/etc/", "/proc/", "/sys/", "/dev/", "/run/", "/boot/", "/snap/",
    "/Applications/", "/Library/", "/System/", "/Volumes/", "/Network/",
    path.join(HOME, ".cache") + "/",
    path.join(HOME, ".config") + "/",
    path.join(HOME, ".local", "share") + "/",
    path.join(HOME, ".local", "state") + "/",
    path.join(HOME, "Library") + "/",
    path.join(HOME, ".npm") + "/", path.join(HOME, ".yarn") + "/",
    path.join(HOME, ".pnpm-store") + "/", path.join(HOME, ".bun") + "/",
    path.join(HOME, ".deno") + "/", path.join(HOME, ".cargo") + "/",
    path.join(HOME, ".rustup") + "/", path.join(HOME, ".gradle") + "/",
    path.join(HOME, ".m2") + "/", path.join(HOME, ".gem") + "/",
    path.join(HOME, ".bundle") + "/", path.join(HOME, ".pyenv") + "/",
    path.join(HOME, ".virtualenvs") + "/", path.join(HOME, ".nvm") + "/",
    path.join(HOME, ".asdf") + "/", path.join(HOME, ".mise") + "/",
    path.join(HOME, ".claude") + "/",
    path.join(HOME, ".ssh") + "/", path.join(HOME, ".gnupg") + "/",
    path.join(HOME, ".aws") + "/", path.join(HOME, ".kube") + "/",
    path.join(HOME, ".docker") + "/",
  ];
  const TMPDIR = process.env.TMPDIR;
  if (TMPDIR) prefixes.push(TMPDIR.endsWith("/") ? TMPDIR : TMPDIR + "/");

  // Normalize separators to / on both sides so HOME-relative prefixes
  // (constructed via path.join, backslash on Windows) compare correctly
  // against the candidate path (also backslash on Windows). Unix-only
  // prefixes ('/tmp/' etc.) are already '/'-form and just won't match on
  // Windows — which is correct, those paths don't exist there.
  const absFwd = abs.replace(/\\/g, "/");
  for (const pref of prefixes) {
    const prefFwd = pref.replace(/\\/g, "/");
    if (absFwd + "/" === prefFwd) return { blocked: true, reason: `prefix-blocklist root: ${prefFwd}` };
    if (absFwd.startsWith(prefFwd)) return { blocked: true, reason: `prefix-blocklist: ${prefFwd}` };
  }
  return { blocked: false };
}

export interface UmbrellaCtx { dir: string; slug: string; }

export type Classification =
  | { kind: "blocked"; reason: string }
  | { kind: "skip"; reason: string }
  | { kind: "single"; projectDir: string; umbrella?: UmbrellaCtx }
  | { kind: "umbrella"; projectDir: string; tool: string; children: string[] };

function basenameSlug(p: string): string {
  return path.basename(p).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}

function findImplicitSubprojects(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    if (HEAVY_DIRS.has(e.name)) continue;
    const sub = path.join(dir, e.name);
    if (hasStrongSignal(sub)) out.push(sub);
  }
  return out;
}

// Does `parent` qualify as an umbrella that includes `child`?
// Used when the user opens directly inside a sub-project — we need to detect
// that the parent is an umbrella so we can prefix the slug correctly.
function isUmbrellaParentOf(parent: string, child: string): { is: boolean; tool: string } {
  if (!hasStrongSignal(parent)) return { is: false, tool: "" };
  const ws = detectWorkspaces(parent);
  if (ws) {
    if (ws.children.some(c => path.resolve(c) === path.resolve(child))) return { is: true, tool: ws.tool };
  }
  const implicit = findImplicitSubprojects(parent);
  if (implicit.length >= 2 && implicit.some(c => path.resolve(c) === path.resolve(child))) {
    return { is: true, tool: "implicit" };
  }
  return { is: false, tool: "" };
}

export function classifyPath(cwd: string): Classification {
  const abs = path.resolve(cwd);
  const block = isBlockedPath(abs);
  if (block.blocked) return { kind: "blocked", reason: block.reason || "blocked" };
  if (!hasStrongSignal(abs)) return { kind: "skip", reason: `no strong project signal at ${abs}` };

  // We have a strong signal. Two questions: am I a child of an umbrella, or
  // am I myself an umbrella? Walk up one level to check the first.
  const parent = path.dirname(abs);
  if (parent !== abs && !isBlockedPath(parent).blocked) {
    const ub = isUmbrellaParentOf(parent, abs);
    if (ub.is) {
      return { kind: "single", projectDir: abs, umbrella: { dir: parent, slug: basenameSlug(parent) } };
    }
  }

  // Am I an umbrella? Explicit workspace declaration wins over heuristic.
  const ws = detectWorkspaces(abs);
  if (ws && ws.children.length >= 2) {
    return { kind: "umbrella", projectDir: abs, tool: ws.tool, children: ws.children };
  }
  const implicit = findImplicitSubprojects(abs);
  if (implicit.length >= 2) {
    return { kind: "umbrella", projectDir: abs, tool: "implicit", children: implicit };
  }

  return { kind: "single", projectDir: abs };
}

export { basenameSlug };
