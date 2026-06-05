import { spawnSync } from "node:child_process";
import { classifyPath, basenameSlug } from "./projectDetect.js";

/**
 * Resolve a stable project slug for the given working directory.
 *
 * Uses the git root as the canonical project directory so that subdirectories
 * of the same repo always resolve to the same slug, eliminating basename
 * collisions (e.g. two repos named "web" under different parent paths).
 *
 * Returns undefined when cwd does not map to a recognizable project.
 */
export function resolveProjectSlug(cwd: string): string | undefined {
  const classification = classifyPath(cwd);
  if (classification.kind !== "single" && classification.kind !== "umbrella") {
    return undefined;
  }
  const projectDir = classification.projectDir;
  // Try to find the git root from the project dir.
  // If git is not available or the dir is not inside a git repo, fall back to projectDir.
  let canonicalDir = projectDir;
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0 && result.stdout.trim()) {
      canonicalDir = result.stdout.trim();
    }
  } catch {
    // spawnSync itself failed (git not found etc.) — fall back to projectDir
  }
  return basenameSlug(canonicalDir);
}
