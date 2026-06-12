import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginRoot as defaultPluginRoot } from "./paths.js";
import { spawnDetachedChild } from "./spawnChild.js";
// Bounded search for a compiled native addon (*.node) within a directory.
function hasDotNode(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return false;
    }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (hasDotNode(p))
                return true;
        }
        else if (e.name.endsWith(".node"))
            return true;
    }
    return false;
}
// Deps are "present" only when better-sqlite3's NATIVE BINDING actually exists
// — not merely when the package directory does. A source-only install (no
// build/Release/*.node, no prebuilds/) means the addon was never compiled
// (e.g. a Node ABI with no published prebuild + a bootstrap that didn't
// rebuild). Treating that as ready causes silent require() crashes downstream
// and never surfaces to the sentinel. Stays builtin-only (no require of the
// native module) so import-safe entrypoints can call it cheaply.
export function depsPresent(pluginRoot) {
    try {
        const bs = path.join(pluginRoot, "node_modules", "better-sqlite3");
        if (!fs.existsSync(bs))
            return false;
        return hasDotNode(path.join(bs, "build")) ||
            hasDotNode(path.join(bs, "prebuilds")) ||
            hasDotNode(path.join(bs, "lib", "binding"));
    }
    catch {
        return false;
    }
}
// bootstrap-done is PER-INSTALL: written inside the plugin's own version dir
// at `<pluginRoot>/.bootstrap-done`. This is critical because Claude Code
// installs each plugin version in a fresh directory, and a global sentinel
// (the old design at ~/.superbrain/bootstrap-done) would inherit "done"
// across upgrades while the new install's node_modules still lacks the
// rebuilt better-sqlite3 native binding. Per-install + the depsPresent()
// conjoined check in bin/sb-bootstrap.ts together make bootstrap self-heal
// across plugin upgrades and Node ABI changes.
function doneFile(root) { return path.join(root, ".bootstrap-done"); }
export function bootstrapDone(root = defaultPluginRoot()) {
    return fs.existsSync(doneFile(root));
}
export function markBootstrapDone(root = defaultPluginRoot()) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(doneFile(root), new Date().toISOString());
}
// Detached, fire-and-forget. The dedicated bin/sb-bootstrap.js runs `npm ci`
// under a lock and writes bootstrap-done / the sentinel itself.
export function runBootstrap(pluginRoot) {
    if (bootstrapDone(pluginRoot) && depsPresent(pluginRoot))
        return;
    const runner = fileURLToPath(new URL("../bin/sb-bootstrap.js", import.meta.url));
    spawnDetachedChild("bootstrap", runner, {
        ...process.env, SUPERBRAIN_CHILD: "1", SUPERBRAIN_PLUGIN_ROOT: pluginRoot,
    }, { cwd: pluginRoot });
}
