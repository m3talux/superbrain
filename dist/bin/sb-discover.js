#!/usr/bin/env node
import { runDiscover, runDiscoverForce } from "../src/discoverer.js";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";
// Detached, lock-serialized project discoverer. Spawned by sb-session-start
// the first time a session opens in an unknown project (auto mode). Also
// invokable manually via `/superbrain:discover` (force mode) — `--force`
// runs even when a project note already exists and appends a
// `## SuperBrain discovery (date)` section instead of overwriting.
// Fire-and-forget; failures land in the sentinel.
async function main() {
    if (!depsPresent(pluginRoot())) {
        process.exit(0);
    }
    const args = process.argv.slice(2);
    const force = args.includes("--force");
    const positional = args.filter(a => !a.startsWith("--"));
    const projectDir = positional[0]
        || process.env.SUPERBRAIN_PROJECT_DIR
        || process.env.CLAUDE_PROJECT_DIR
        || process.cwd();
    try {
        if (force)
            await runDiscoverForce(projectDir);
        else
            await runDiscover(projectDir);
    }
    catch { /* sentinel handles errors inside runDiscover */ }
    process.exit(0);
}
if ((process.argv[1] && process.argv[1].endsWith("sb-discover.ts")) || process.argv[1]?.endsWith("sb-discover.js"))
    main();
