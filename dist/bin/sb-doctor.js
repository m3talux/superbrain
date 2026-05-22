#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
function dirSize(p) {
    if (!fs.existsSync(p))
        return 0;
    let total = 0;
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, ent.name);
        if (ent.isDirectory())
            total += dirSize(full);
        else if (ent.isFile()) {
            try {
                total += fs.statSync(full).size;
            }
            catch { /* ignore */ }
        }
    }
    return total;
}
function fileCount(p, pattern) {
    if (!fs.existsSync(p))
        return 0;
    const files = fs.readdirSync(p);
    return pattern ? files.filter(f => pattern.test(f)).length : files.length;
}
function humanize(bytes) {
    if (bytes === 0)
        return "0";
    const units = ["B", "K", "M", "G"];
    let v = bytes;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
        v /= 1024;
        u++;
    }
    return `${v.toFixed(v >= 10 ? 0 : 1)}${units[u]}`;
}
function disk() {
    const home = os.homedir();
    const sb = path.join(home, ".superbrain");
    const vault = path.join(sb, "vault");
    const stats = [];
    // vault breakdown
    const vaultGit = dirSize(path.join(vault, ".git"));
    const vaultTrash = dirSize(path.join(vault, ".trash"));
    const vaultTotal = dirSize(vault);
    const vaultNotes = vaultTotal - vaultGit - vaultTrash;
    stats.push({ name: "vault", bytes: vaultTotal, extra: `.git: ${humanize(vaultGit)}, notes: ${humanize(vaultNotes)}, .trash: ${humanize(vaultTrash)}` });
    // index.db
    const idx = path.join(sb, "index.db");
    stats.push({ name: "index.db", bytes: fs.existsSync(idx) ? fs.statSync(idx).size : 0 });
    // transcripts
    const transcripts = path.join(sb, "transcripts");
    const txCount = fileCount(transcripts, /\.jsonl$/);
    stats.push({ name: "transcripts", bytes: dirSize(transcripts), extra: `${txCount} snapshots` });
    // sessions
    stats.push({ name: "sessions", bytes: dirSize(path.join(sb, "sessions")) });
    const total = stats.reduce((s, x) => s + x.bytes, 0);
    console.log("SuperBrain disk usage:");
    const maxNameLen = Math.max(...stats.map(s => s.name.length));
    for (const s of stats) {
        const padded = s.name.padEnd(maxNameLen + 1);
        const sizeStr = humanize(s.bytes).padStart(6);
        const extra = s.extra ? `  (${s.extra})` : "";
        console.log(`  ${padded} ${sizeStr}${extra}`);
    }
    console.log(`  ${"Total".padEnd(maxNameLen + 1)} ${humanize(total).padStart(6)}`);
}
function main() {
    const cmd = process.argv[2];
    if (!cmd || cmd === "--help" || cmd === "-h") {
        console.log("usage: sb-doctor <disk|inject>");
        process.exit(0);
    }
    if (cmd === "disk")
        return disk();
    if (cmd === "inject") {
        // T33 will implement this — for now print a TODO and exit 0.
        console.log("sb-doctor inject: not yet implemented (see T33)");
        return;
    }
    console.error(`unknown subcommand: ${cmd}`);
    process.exit(2);
}
main();
