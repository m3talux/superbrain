#!/usr/bin/env -S node --experimental-strip-types
import fs from "node:fs";
import path from "node:path";
import { parseNote, serializeNote } from "../src/frontmatter.js";

const DEFAULT_CAP = Number(process.env.SUPERBRAIN_PROJECT_NOTE_CAP_BYTES) || 32 * 1024;
const LOW_WATER_RATIO = 0.8;

const STRUCTURAL = new Set([
  "## What it is",
  "## Status",
  "## Architecture",
  "## Recent activity",
  "## Gotchas",
]);

const normBody = (s: string): string => s.replace(/\s+/g, " ").trim();

export interface ArchivedBlock { date: string; content: string }
export interface RollupNote {
  file: string;
  slug: string;
  oldBytes: number;
  newBody: string;
  frontmatter: Record<string, any>;
  archived: ArchivedBlock[];
  archivedSectionCount: number;
}
export interface RollupPlan { notes: RollupNote[]; cap: number }

interface RawSection { date: string; start: number; end: number }

function collectArchivable(body: string): RawSection[] {
  const headingRe = /\n(#{2,3}) (.+)\n/g;
  const heads: Array<{ idx: number; level: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(body)) !== null) {
    heads.push({ idx: m.index, level: m[1].length, text: m[2].trim() });
  }
  const out: RawSection[] = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    if (h.level === 2 && STRUCTURAL.has(`## ${h.text}`)) continue;
    const dateM = h.text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateM && !/^Gotcha\b/.test(h.text)) continue;
    out.push({
      date: dateM ? dateM[1] : "0000-00-00",
      start: h.idx,
      end: i + 1 < heads.length ? heads[i + 1].idx : body.length,
    });
  }
  return out;
}

function sectionContent(body: string, s: RawSection): string {
  const block = body.slice(s.start, s.end);
  const headingEnd = block.indexOf("\n", 1) + 1;
  return block.slice(headingEnd).replace(/^\s+|\s+$/g, "");
}

function rollupBody(body: string, cap: number): { newBody: string; archived: ArchivedBlock[] } {
  let updated = body;
  const archived: ArchivedBlock[] = [];
  const lowWater = Math.floor(cap * LOW_WATER_RATIO);
  const seen = new Set<string>();
  let secs = collectArchivable(updated);
  for (let i = secs.length - 1; i >= 0; i--) {
    const c = normBody(sectionContent(updated, secs[i]));
    if (c.length >= 40 && seen.has(c)) {
      archived.push({ date: secs[i].date, content: sectionContent(updated, secs[i]) });
      updated = updated.slice(0, secs[i].start) + updated.slice(secs[i].end);
      updated = updated.replace(/\n{3,}/g, "\n\n");
      secs = collectArchivable(updated);
    } else if (c.length >= 40) {
      seen.add(c);
    }
  }
  let target = lowWater;
  while (Buffer.byteLength(updated, "utf8") > target) {
    const list = collectArchivable(updated);
    if (list.length === 0) break;
    let oldest = list[0];
    for (const s of list) {
      if (s.date < oldest.date || (s.date === oldest.date && s.start < oldest.start)) oldest = s;
    }
    archived.push({ date: oldest.date, content: sectionContent(updated, oldest) });
    updated = updated.slice(0, oldest.start) + updated.slice(oldest.end);
    updated = updated.replace(/\n{3,}/g, "\n\n");
    if (Buffer.byteLength(updated, "utf8") <= cap) target = cap;
  }
  return { newBody: updated, archived };
}

function walkProjects(vaultDir: string): string[] {
  const dir = path.join(vaultDir, "projects");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(dir, e.name));
}

export function planRollup(vaultDir: string, cap: number = DEFAULT_CAP): RollupPlan {
  const notes: RollupNote[] = [];
  for (const file of walkProjects(vaultDir)) {
    const raw = fs.readFileSync(file, "utf8");
    const oldBytes = Buffer.byteLength(raw, "utf8");
    if (oldBytes <= cap) continue;
    const parsed = parseNote(raw);
    const { newBody, archived } = rollupBody(parsed.content, cap);
    notes.push({
      file,
      slug: path.basename(file, ".md"),
      oldBytes,
      newBody,
      frontmatter: parsed.data,
      archived,
      archivedSectionCount: archived.length,
    });
  }
  return { notes, cap };
}

export function applyRollup(vaultDir: string, plan: RollupPlan): void {
  const trashDir = path.join(vaultDir, ".trash");
  fs.mkdirSync(trashDir, { recursive: true });
  const ts = Date.now();
  for (const n of plan.notes) {
    fs.copyFileSync(n.file, path.join(trashDir, `${ts}-${n.slug}.md`));
    for (const a of n.archived) {
      const year = a.date === "0000-00-00" ? new Date().toISOString().slice(0, 4) : a.date.slice(0, 4);
      const month = a.date === "0000-00-00" ? new Date().getMonth() + 1 : parseInt(a.date.slice(5, 7), 10);
      const q = Math.ceil(month / 3);
      const ap = path.join(vaultDir, "projects", "_archive", `${n.slug}-${year}-Q${q}.md`);
      fs.mkdirSync(path.dirname(ap), { recursive: true });
      if (!fs.existsSync(ap)) {
        fs.writeFileSync(ap, serializeNote(
          { type: "summary", project: n.slug, archived_from: `projects/${n.slug}.md` },
          `# ${n.slug} — archive ${year} Q${q}\n`,
        ));
      }
      fs.appendFileSync(ap, `\n### ${a.date}\n\n${a.content}\n`);
    }
    fs.writeFileSync(n.file, serializeNote(n.frontmatter, n.newBody));
  }
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const vault = args.find((a) => !a.startsWith("--")) || process.env["SUPERBRAIN_VAULT_DIR"];
  if (!vault) { console.error("usage: rollup-runaway-notes.ts <vault-dir> [--apply]"); process.exit(1); }
  if (!fs.existsSync(vault)) { console.error(`Vault not found: ${vault}`); process.exit(1); }

  const plan = planRollup(vault);
  if (plan.notes.length === 0) { console.log("No project notes over cap. Nothing to do."); return; }

  for (const n of plan.notes) {
    const newBytes = Buffer.byteLength(serializeNote(n.frontmatter, n.newBody), "utf8");
    console.log(`${n.slug}: ${n.oldBytes} -> ${newBytes} bytes, archiving ${n.archivedSectionCount} section(s)`);
  }
  if (!apply) {
    console.log("\n(Dry-run. Use --apply to write changes. Originals are snapshotted to .trash.)");
  } else {
    applyRollup(vault, plan);
    console.log(`\nApplied. ${plan.notes.length} note(s) compacted; originals snapshotted to .trash.`);
  }
}

if (
  process.argv[1]?.endsWith("rollup-runaway-notes.ts") ||
  process.argv[1]?.endsWith("rollup-runaway-notes.js")
) {
  main();
}
