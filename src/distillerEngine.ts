import { fileURLToPath } from "node:url";

export function isChild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUPERBRAIN_CHILD === "1";
}
export interface SpawnSpec {
  cmd: string;
  args: string[];
  options: { cwd: string; env: NodeJS.ProcessEnv; detached: true; stdio: "ignore" };
}
export function distillScriptPath(): string {
  // dist/src/distillerEngine.js  ->  dist/bin/sb-distill.js
  return fileURLToPath(new URL("../bin/sb-distill.js", import.meta.url));
}
export function buildDistillCommand(opts: { sessionId: string; cwd: string; lockToken?: string }): SpawnSpec {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SUPERBRAIN_CHILD: "1",
    SUPERBRAIN_SESSION_ID: opts.sessionId,
    ...(opts.lockToken ? { SUPERBRAIN_LOCK_TOKEN: opts.lockToken } : {}),
  };
  return {
    cmd: process.execPath,
    args: [distillScriptPath()],
    options: { cwd: opts.cwd, env, detached: true, stdio: "ignore" },
  };
}
