// Hardcoded model for every detached `claude -p` spawn (distill, daily
// rollup, project discovery). Sonnet 4.6 — see src/distillRun.ts for the
// full rationale. Kept in its own tiny module with no deps so import-safe
// entrypoints (bin/*) can reference it without pulling vaultWriter →
// gray-matter into the load graph before depsPresent() runs.
export function distillModel(): string {
  return "claude-sonnet-4-6";
}
