import { execFileSync } from "node:child_process";
import { distillModel } from "./model.js";
// Windows execFile does not auto-resolve .cmd / .exe extensions. Claude Code's
// Windows installer ships as `claude.cmd`, so a direct execFile returns ENOENT.
// shell: true routes through cmd.exe which DOES resolve the extension. Non-
// Windows: shell: false keeps argument escaping simple and safe.
export function buildClaudeSpawnOptions(platform) {
    const opts = { encoding: "utf8" };
    if (platform === "win32")
        opts.shell = true;
    return opts;
}
export function claudeP(prompt) {
    const args = ["--model", distillModel(), "-p", prompt];
    return execFileSync("claude", args, buildClaudeSpawnOptions(process.platform));
}
