import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function dataDir(): string {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".superbrain");
}
export function vaultPath(): string {
  if (process.env.SUPERBRAIN_VAULT) return process.env.SUPERBRAIN_VAULT;
  const legacy = path.join(os.homedir(), "vault");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(os.homedir(), "Documents", "SuperBrain");
}
function sessionsDir(): string { return path.join(dataDir(), "sessions"); }
export function sessionNdjsonPath(id: string): string { return path.join(sessionsDir(), `${id}.ndjson`); }
export function cursorPath(id: string): string { return path.join(sessionsDir(), `${id}.cursor`); }
export function sentinelPath(): string { return path.join(dataDir(), "last-failure.txt"); }
export function rollupStatePath(): string { return path.join(dataDir(), "rollup-state.json"); }
export function lockDir(name: string): string { return path.join(dataDir(), "locks", `${name}.lock`); }
