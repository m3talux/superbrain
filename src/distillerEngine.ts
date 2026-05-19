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
export function buildDistillCommand(opts: { sessionId: string; cwd: string; rollup?: string }): SpawnSpec {
  // Spawn the in-process writer (bin/sb-distill.ts). It performs the real
  // `claude -p` LLM call itself (getItems), then routes/writes/logs/advances
  // cursor/releases the lock. ANTHROPIC_API_KEY (if set) is inherited so the
  // claude CLI uses the API path automatically — escape hatch, no command change.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SUPERBRAIN_CHILD: "1",
    SUPERBRAIN_SESSION_ID: opts.sessionId,
  };
  if (opts.rollup) env.SUPERBRAIN_ROLLUP = opts.rollup;
  return {
    cmd: process.execPath, // node
    args: [distillScriptPath()],
    options: { cwd: opts.cwd, env, detached: true, stdio: "ignore" },
  };
}
