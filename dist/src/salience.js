const WRITE_THRESHOLD = 5;
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "ctx_edit"]);
const PUSHBACK_RE = /\b(no,|don'?t|do not|stop|revert|undo|that'?s wrong|not what i|use .* instead|actually,|why did you)\b|(^|\s)lesson:/i;
export function initState() {
    return { writesSinceNote: 0, lastCwd: null };
}
export function scoreEvent(state, e) {
    const next = { ...state };
    const now = new Date().toISOString();
    const mk = (reason) => ({
        type: "salient", reason, cwd: e.cwd, files: e.file ? [e.file] : [],
        prompt_excerpt: (e.prompt || "").slice(0, 200), ts: now,
    });
    if (e.type === "prompt" && PUSHBACK_RE.test(e.prompt || "")) {
        next.lastCwd = e.cwd || state.lastCwd;
        return { pending: true, marker: mk("pushback"), state: next };
    }
    if (state.lastCwd && e.cwd && e.cwd !== state.lastCwd) {
        next.lastCwd = e.cwd;
        next.writesSinceNote = 0;
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
