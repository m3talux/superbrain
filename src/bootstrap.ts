import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dataDir } from "./paths.js";

export function depsPresent(pluginRoot: string): boolean {
  try { return fs.existsSync(path.join(pluginRoot, "node_modules", "better-sqlite3")); }
  catch { return false; }
}

function doneFile(): string { return path.join(dataDir(), "bootstrap-done"); }
export function bootstrapDone(): boolean { return fs.existsSync(doneFile()); }
export function markBootstrapDone(): void {
  fs.mkdirSync(path.dirname(doneFile()), { recursive: true });
  fs.writeFileSync(doneFile(), new Date().toISOString());
}

// Detached, fire-and-forget. The dedicated bin/sb-bootstrap.js runs `npm ci`
// under a lock and writes bootstrap-done / the sentinel itself.
export function runBootstrap(pluginRoot: string): void {
  if (bootstrapDone()) return;
  try {
    const runner = fileURLToPath(new URL("../bin/sb-bootstrap.js", import.meta.url));
    spawn(process.execPath, [runner], {
      detached: true, stdio: "ignore",
      env: { ...process.env, SUPERBRAIN_CHILD: "1", SUPERBRAIN_PLUGIN_ROOT: pluginRoot },
      cwd: pluginRoot,
    }).unref();
  } catch { /* non-fatal; retried next SessionStart */ }
}
