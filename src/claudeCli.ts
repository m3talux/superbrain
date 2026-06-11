import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { distillModel } from "./model.js";

// Windows execFile does not auto-resolve .cmd / .exe extensions. Claude Code's
// Windows installer ships as `claude.cmd`, so a direct execFile returns ENOENT.
// shell: true routes through cmd.exe which DOES resolve the extension. Non-
// Windows: shell: false keeps argument escaping simple and safe.
export function buildClaudeSpawnOptions(platform: NodeJS.Platform): ExecFileSyncOptionsWithStringEncoding {
  const opts: ExecFileSyncOptionsWithStringEncoding = { encoding: "utf8" };
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
