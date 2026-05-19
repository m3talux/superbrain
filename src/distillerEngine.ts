export function isChild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUPERBRAIN_CHILD === "1";
}
export interface SpawnSpec {
  cmd: string;
  args: string[];
  options: { cwd: string; env: NodeJS.ProcessEnv; detached: true; stdio: "ignore" };
}
export function buildDistillCommand(opts: { promptFile: string; cwd: string }): SpawnSpec {
  // Default path: `claude -p` reuses the installer's existing Claude Code auth.
  // If ANTHROPIC_API_KEY / SUPERBRAIN_API_KEY is set, the claude CLI picks it up
  // automatically — escape hatch with no command change.
  const prompt = `Run the superbrain-distill skill. Instructions file: ${opts.promptFile}`;
  return {
    cmd: "claude",
    args: ["-p", prompt, "--permission-mode", "acceptEdits"],
    options: {
      cwd: opts.cwd,
      env: { ...process.env, SUPERBRAIN_CHILD: "1" },
      detached: true,
      stdio: "ignore",
    },
  };
}
