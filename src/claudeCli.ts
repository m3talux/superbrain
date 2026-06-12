import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { distillModel } from "./model.js";

// Windows execFile does not auto-resolve .cmd / .exe extensions. Claude Code's
// Windows installer ships as `claude.cmd`, so a direct execFile returns ENOENT.
// shell: true routes through cmd.exe which DOES resolve the extension. Non-
// Windows: shell: false keeps argument escaping simple and safe.
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export function buildClaudeSpawnOptions(platform: NodeJS.Platform): ExecFileSyncOptionsWithStringEncoding {
  // Without a timeout a wedged `claude -p` blocks execFileSync indefinitely,
  // stranding the distill (and its lock) until the process is killed by hand.
  // A bounded timeout makes the hang throw, which the caller's catch routes to
  // the sentinel + lock release. maxBuffer is raised well above Node's 1MB
  // default so a large distill payload is not itself mistaken for a failure.
  const envTimeout = Number(process.env.SUPERBRAIN_DISTILL_TIMEOUT_MS);
  const timeout = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS;
  const opts: ExecFileSyncOptionsWithStringEncoding = {
    encoding: "utf8",
    timeout,
    maxBuffer: MAX_BUFFER_BYTES,
  };
  if (platform === "win32") opts.shell = true;
  return opts;
}

// The prompt travels on stdin, never argv: a session delta above ARG_MAX
// (~1MB on macOS) makes an argv prompt fail with E2BIG before claude even
// spawns, permanently stranding that session's distill.
export function buildClaudePInvocation(
  prompt: string,
  platform: NodeJS.Platform = process.platform,
): { args: string[]; options: ExecFileSyncOptionsWithStringEncoding } {
  const options = buildClaudeSpawnOptions(platform);
  options.input = prompt;
  return { args: ["--model", distillModel(), "-p"], options };
}

export function claudeP(prompt: string): string {
  const { args, options } = buildClaudePInvocation(prompt);
  return execFileSync("claude", args, options);
}
