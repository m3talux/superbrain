#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { readInjectLog, summarize } from "../src/injectTelemetry.js";
import { vaultPath } from "../src/paths.js";

interface DirStats { name: string; bytes: number; extra?: string; }

function dirSize(p: string): number {
  if (!fs.existsSync(p)) return 0;
  let total = 0;
  for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, ent.name);
    if (ent.isDirectory()) total += dirSize(full);
    else if (ent.isFile()) {
      try { total += fs.statSync(full).size; } catch { /* ignore */ }
    }
  }
  return total;
}

function fileCount(p: string, pattern?: RegExp): number {
  if (!fs.existsSync(p)) return 0;
  const files = fs.readdirSync(p);
  return pattern ? files.filter(f => pattern.test(f)).length : files.length;
}

function humanize(bytes: number): string {
  if (bytes === 0) return "0";
  const units = ["B", "K", "M", "G"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)}${units[u]}`;
}

function disk(): void {
  const home = os.homedir();
  const sb = path.join(home, ".superbrain");
  const vault = path.join(sb, "vault");
  const stats: DirStats[] = [];

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

// ---------------------------------------------------------------------------
// migrate-all orchestrator
// ---------------------------------------------------------------------------

interface MigrationStep {
  name: string;
  script: string;
}

const MIGRATION_STEPS: MigrationStep[] = [
  { name: "backfill-frontmatter",        script: "scripts/backfill-frontmatter.ts" },
  { name: "retro-collapse-duplicates",   script: "scripts/retro-collapse-duplicates.ts" },
  { name: "migrate-vault",               script: "scripts/migrate-vault.ts" },
  { name: "retro-prune-preferences",     script: "scripts/retro-prune-preferences.ts" },
];

function pluginRoot(): string {
  // dist/bin/sb-doctor.js → plugin root is 2 dirs up
  return path.resolve(path.dirname(process.argv[1] || __filename), "..", "..");
}

async function migrateAll(): Promise<void> {
  const vault = vaultPath();
  const root = pluginRoot();
  const isFake = process.env.SUPERBRAIN_FAKE_MIGRATE === "1";

  console.log("SuperBrain migrate-all");
  console.log(`Vault: ${vault}`);
  console.log("");

  // Dry-run each step
  for (let i = 0; i < MIGRATION_STEPS.length; i++) {
    const step = MIGRATION_STEPS[i];
    console.log(`Step ${i + 1}/${MIGRATION_STEPS.length}: ${step.name}`);

    if (isFake) {
      console.log("  (fake mode — skipping dry-run)");
    } else {
      const scriptPath = path.join(root, step.script);
      if (!fs.existsSync(scriptPath)) {
        console.log(`  (script not found: ${step.script})`);
      } else {
        const r = spawnSync("npx", ["tsx", scriptPath, vault], {
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
        });
        const out = (r.stdout || "").trim();
        const err = (r.stderr || "").trim();
        if (out) console.log(out.split("\n").map((l) => `  ${l}`).join("\n"));
        if (err) console.error(err.split("\n").map((l) => `  ${l}`).join("\n"));
        if (r.status !== 0) console.log(`  (exited with status ${r.status})`);
      }
    }
    console.log("");
  }

  // Prompt for confirmation
  const answer = await new Promise<string>((resolve) => {
    process.stdout.write("Apply all 4 steps? [y/N]: ");
    let buf = "";
    let resolved = false;
    function onData(chunk: Buffer | string) {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1 && !resolved) {
        resolved = true;
        process.stdin.removeListener("data", onData);
        process.stdin.removeListener("end", onEnd);
        resolve(buf.slice(0, nl).trim().toLowerCase());
      }
    }
    function onEnd() {
      if (!resolved) {
        resolved = true;
        resolve(buf.trim().toLowerCase());
      }
    }
    process.stdin.resume();
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });

  if (answer !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }

  console.log("\nApplying...\n");

  for (let i = 0; i < MIGRATION_STEPS.length; i++) {
    const step = MIGRATION_STEPS[i];
    console.log(`Step ${i + 1}/${MIGRATION_STEPS.length}: ${step.name} --apply`);

    if (isFake) {
      console.log("  [fake] applied");
    } else {
      const scriptPath = path.join(root, step.script);
      if (!fs.existsSync(scriptPath)) {
        console.log(`  (skipped — script not found: ${step.script})`);
        continue;
      }
      const r = spawnSync("npx", ["tsx", scriptPath, vault, "--apply"], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      });
      const out = (r.stdout || "").trim();
      const err = (r.stderr || "").trim();
      if (out) console.log(out.split("\n").map((l) => `  ${l}`).join("\n"));
      if (err) console.error(err.split("\n").map((l) => `  ${l}`).join("\n"));
      if (r.status !== 0) {
        console.error(`  Step exited with status ${r.status} — continuing`);
      } else {
        console.log("  done");
      }
    }
    console.log("");
  }

  console.log("migrate-all complete.");
  process.exit(0);
}

function main(): void {
  const cmd = process.argv[2];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log("usage: sb-doctor <disk|inject|migrate-all>");
    process.exit(0);
  }
  if (cmd === "disk") return disk();
  if (cmd === "inject") {
    const limit = 50;
    const records = readInjectLog(limit);
    const s = summarize(records);
    console.log(`Inject telemetry (last ${limit} sessions):`);
    const channels: Array<keyof typeof records[0]["tokens"]> = ["recall", "preferences", "openThreads", "notices"];
    const hookOrder = ["SessionStart", "UserPromptSubmit"];
    const hooks = hookOrder.filter((h) => s.byHook[h]);
    if (hooks.length === 0) {
      console.log("  (no records yet)");
      return;
    }
    for (const hook of hooks) {
      const entry = s.byHook[hook];
      console.log(`  ${hook} (${entry.count} record${entry.count === 1 ? "" : "s"}):`);
      for (const ch of channels) {
        const val = String(Math.round(entry.avg[ch] || 0));
        console.log(`    ${ch.padEnd(16)} ${val.padStart(4)} tok avg`);
      }
      console.log(`    ${"Total".padEnd(16)} ${String(Math.round(entry.avgTotal)).padStart(4)} tok avg`);
    }
    return;
  }
  if (cmd === "migrate-all") {
    migrateAll().catch((e) => { console.error(e); process.exit(1); });
    return;
  }
  console.error(`unknown subcommand: ${cmd}`);
  process.exit(2);
}

main();
