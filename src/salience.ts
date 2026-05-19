export interface SalienceState {
  writesSinceNote: number;
  lastCwd: string | null;
}
export interface SalientMarker {
  type: "salient";
  reason: "write_threshold" | "git_commit" | "cwd_switch" | "file_churn";
  cwd: string;
  files: string[];
  prompt_excerpt: string;
  ts: string;
}
export interface ObsEvent {
  type: "tool" | "prompt";
  tool?: string;
  command?: string;
  file?: string;
  cwd: string;
  prompt?: string;
}

const WRITE_THRESHOLD = 5;
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "ctx_edit"]);

export function initState(): SalienceState {
  return { writesSinceNote: 0, lastCwd: null };
}

export function scoreEvent(
  state: SalienceState,
  e: ObsEvent
): { pending: boolean; marker?: SalientMarker; state: SalienceState } {
  const next: SalienceState = { ...state };
  const now = new Date().toISOString();
  const mk = (reason: SalientMarker["reason"]): SalientMarker => ({
    type: "salient", reason, cwd: e.cwd, files: e.file ? [e.file] : [],
    prompt_excerpt: (e.prompt || "").slice(0, 200), ts: now,
  });

  if (state.lastCwd && e.cwd && e.cwd !== state.lastCwd) {
    next.lastCwd = e.cwd; next.writesSinceNote = 0;
    return { pending: true, marker: mk("cwd_switch"), state: next };
  }
  next.lastCwd = e.cwd || state.lastCwd;

  if (e.type === "tool" && e.tool === "Bash" && /\bgit\s+commit\b/.test(e.command || "")) {
    next.writesSinceNote = 0;
    return { pending: true, marker: mk("git_commit"), state: next };
  }
  if (e.type === "tool" && e.tool && WRITE_TOOLS.has(e.tool)) {
    next.writesSinceNote = state.writesSinceNote + 1;
    if (next.writesSinceNote >= WRITE_THRESHOLD) {
      next.writesSinceNote = 0;
      return { pending: true, marker: mk("write_threshold"), state: next };
    }
  }
  return { pending: false, state: next };
}
