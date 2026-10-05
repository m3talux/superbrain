import { execFileSync } from "node:child_process";
import { distillModel } from "./model.js";
// Windows execFile does not auto-resolve .cmd / .exe extensions. Claude Code's
// Windows installer ships as `claude.cmd`, so a direct execFile returns ENOENT.
// shell: true routes through cmd.exe which DOES resolve the extension. Non-
// Windows: shell: false keeps argument escaping simple and safe.
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
export function buildClaudeSpawnOptions(platform) {
    // Without a timeout a wedged `claude -p` blocks execFileSync indefinitely,
    // stranding the distill (and its lock) until the process is killed by hand.
    // A bounded timeout makes the hang throw, which the caller's catch routes to
    // the sentinel + lock release. maxBuffer is raised well above Node's 1MB
    // default so a large distill payload is not itself mistaken for a failure.
    const envTimeout = Number(process.env.SUPERBRAIN_DISTILL_TIMEOUT_MS);
    const timeout = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS;
    const opts = {
        encoding: "utf8",
        timeout,
        maxBuffer: MAX_BUFFER_BYTES,
    };
    if (platform === "win32")
        opts.shell = true;
    return opts;
}
// The prompt travels on stdin, never argv: a session delta above ARG_MAX
// (~1MB on macOS) makes an argv prompt fail with E2BIG before claude even
// spawns, permanently stranding that session's distill.
// A plain `claude -p` loads the full interactive harness -- the default system
// prompt, every installed plugin's skills, MCP servers, CLAUDE.md files and
// SessionStart hooks -- about 33K input tokens before the distill payload. The
// distiller needs none of it: its instructions travel in the prompt and it
// calls no tools. These flags bring that overhead to under 1K tokens per run,
// and --no-session-persistence stops each run leaving a transcript behind.
const LEAN_SYSTEM_PROMPT = "You turn session data into notes. Follow the instructions in the user message exactly.";
// cmd.exe (shell: true on win32) drops a bare empty argument and splits on
// spaces, so values are quoted there; elsewhere execFile passes them verbatim.
function shellArg(value, platform) {
    return platform === "win32" ? `"${value}"` : value;
}
export function leanClaudeArgs(platform) {
    return [
        "--tools", shellArg("", platform),
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--setting-sources", shellArg("", platform),
        "--no-session-persistence",
        "--system-prompt", shellArg(LEAN_SYSTEM_PROMPT, platform),
    ];
}
export function buildClaudePInvocation(prompt, platform = process.platform) {
    const options = buildClaudeSpawnOptions(platform);
    options.input = prompt;
    return { args: ["--model", distillModel(), ...leanClaudeArgs(platform), "-p"], options };
}
export function claudeP(prompt) {
    const { args, options } = buildClaudePInvocation(prompt);
    return execFileSync("claude", args, options);
}
