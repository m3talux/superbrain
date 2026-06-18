import fs from "node:fs";
import path from "node:path";
import { sentinelPath, dataDir, pluginRoot } from "./paths.js";

/**
 * Failure history cap. Mirrors the windowed-log pattern of the reject queue
 * (rejectQueue.ts): keep the newest N entries, drop the oldest. 100 lines is
 * weeks of failures while staying trivially greppable.
 */
export const MAX_FAILURE_LOG_LINES = 100;

export function failureLogPath(): string {
  return path.join(dataDir(), "failures.log");
}

// During the 2026-06 cross-version incident, multiple immutable plugin caches
// (different versions) shared one ~/.superbrain — an unattributed failure
// line could have been written by any of them. Stamp every line with the
// version of the package that wrote it.
let cachedVersion: string | null = null;
function pluginVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot(), "package.json"), "utf8"));
    cachedVersion = typeof pkg.version === "string" && pkg.version ? pkg.version : "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}

export function writeFailure(message: string): void {
  const p = sentinelPath();
  const line = `[${new Date().toISOString()}] [v${pluginVersion()}] ${message}\n`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, line);
  // Failure HISTORY: last-failure.txt is read-and-clear and each write
  // overwrites the previous one, which destroyed diagnosability during the
  // incident. Also append to a bounded failures.log (never read-and-cleared).
  // Best-effort: history must never break the sentinel write itself.
  try {
    const logP = failureLogPath();
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(logP, "utf8").split("\n").filter(Boolean);
    } catch { /* no log yet */ }
    lines.push(line.trimEnd());
    if (lines.length > MAX_FAILURE_LOG_LINES) lines = lines.slice(-MAX_FAILURE_LOG_LINES);
    fs.writeFileSync(logP, lines.join("\n") + "\n");
  } catch { /* best-effort */ }
}
export function readAndClearFailure(): string | null {
  const p = sentinelPath();
  try {
    const msg = fs.readFileSync(p, "utf8").trim();
    fs.rmSync(p, { force: true });
    return msg || null;
  } catch { return null; }
}
