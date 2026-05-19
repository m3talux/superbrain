#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dataDir, pluginRoot } from "../src/paths.js";
import { markOwned, setRecordedVaultPath, MARKER } from "../src/vaultMarker.js";
import { depsPresent, bootstrapDone } from "../src/bootstrap.js";
function archiveCopyThenUnlink(src, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, path.basename(src));
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
    }
    else {
        fs.copyFileSync(src, dest);
        const fd = fs.openSync(dest, "r");
        try {
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
    }
    fs.rmSync(src, { recursive: true, force: true });
}
export function migrateLegacy(home = os.homedir(), dryRun = false) {
    const targets = [
        path.join(home, ".claude", "hooks", "stop-scribe.sh"),
        path.join(home, ".claude", "skills", "scribe"),
    ].filter((t) => fs.existsSync(t));
    if (dryRun)
        return { archived: targets.map((t) => path.basename(t)), dryRun: true };
    const archived = [];
    if (targets.length) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const destDir = path.join(dataDir(), "archived-legacy", stamp);
        for (const t of targets) {
            archiveCopyThenUnlink(t, destDir);
            archived.push(path.basename(t));
        }
    }
    return { archived, dryRun: false };
}
function doAdopt(target) {
    const abs = path.resolve(target);
    const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
    if (!st || !st.isDirectory())
        throw new Error(`adopt: ${abs} is not a directory`);
    try {
        fs.accessSync(abs, fs.constants.W_OK);
    }
    catch {
        throw new Error(`adopt: ${abs} is not writable`);
    }
    // Refuse a directory marked by a different tool. A `.superbrain` that is a
    // directory (or unreadable) is treated as a foreign marker, not crashed on.
    const mk = path.join(abs, MARKER);
    if (fs.existsSync(mk)) {
        let owned = false;
        try {
            owned = fs.statSync(mk).isFile() && fs.readFileSync(mk, "utf8").includes("superbrain-owned");
        }
        catch {
            owned = false;
        }
        if (!owned)
            throw new Error(`adopt: ${abs} is marked by another tool`);
    }
    markOwned(abs);
    setRecordedVaultPath(abs);
    console.log(`Adopted ${abs} as the SuperBrain vault.`);
    if (depsPresent(pluginRoot())) {
        import("../src/indexer.js").then((m) => m.reconcile()).catch(() => { });
    } // else: the normal SessionStart reconcile will index existing notes post-bootstrap
}
function main() {
    const cmd = process.argv[2];
    const args = process.argv.slice(3);
    if (cmd === "adopt") {
        if (!args[0]) {
            console.log("usage: superbrain adopt <path>");
            process.exit(2);
        }
        doAdopt(args[0]);
        return;
    }
    if (cmd === "migrate") {
        const r = migrateLegacy(os.homedir(), args.includes("--dry-run"));
        if (r.dryRun)
            console.log(r.archived.length ? `[dry-run] would archive: ${r.archived.join(", ")}` : "[dry-run] nothing to migrate");
        else
            console.log(r.archived.length ? `Archived: ${r.archived.join(", ")} -> ${path.join(dataDir(), "archived-legacy")}` : "Nothing to migrate (no legacy scribe found).");
        console.log("Note: legacy MCP layers (mcpvault / claude-mem / obra knowledge-graph) are configured in your Claude settings, not files. Disable them there manually if desired.");
        return;
    }
    if (cmd === "install") {
        fs.mkdirSync(dataDir(), { recursive: true });
        console.log(bootstrapDone() ? "SuperBrain ready." : "SuperBrain installed; first-time dependency setup runs automatically on next Claude Code session.");
        return;
    }
    console.log("usage: superbrain <adopt <path>|migrate [--dry-run]|install>");
}
if ((process.argv[1] && process.argv[1].endsWith("sb.ts")) || process.argv[1]?.endsWith("sb.js"))
    main();
