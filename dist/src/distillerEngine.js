import { fileURLToPath } from "node:url";
export function isChild(env = process.env) {
    return env.SUPERBRAIN_CHILD === "1";
}
export function distillScriptPath() {
    // dist/src/distillerEngine.js  ->  dist/bin/sb-distill.js
    return fileURLToPath(new URL("../bin/sb-distill.js", import.meta.url));
}
export function buildDistillCommand(opts) {
    const env = {
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
