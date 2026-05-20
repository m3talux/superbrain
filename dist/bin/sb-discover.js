#!/usr/bin/env node
import { runDiscover } from "../src/discoverer.js";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";
// Detached, lock-serialized project discoverer. Spawned by sb-session-start
// the first time a session opens in an unknown project. Fire-and-forget —
// failures land in the sentinel, never the user's session.
async function main() {
    if (!depsPresent(pluginRoot())) {
        process.exit(0);
    }
    const projectDir = process.env.SUPERBRAIN_PROJECT_DIR
        || process.env.CLAUDE_PROJECT_DIR
        || process.cwd();
    try {
        await runDiscover(projectDir);
    }
    catch { /* sentinel handles errors inside runDiscover */ }
    process.exit(0);
}
if ((process.argv[1] && process.argv[1].endsWith("sb-discover.ts")) || process.argv[1]?.endsWith("sb-discover.js"))
    main();
