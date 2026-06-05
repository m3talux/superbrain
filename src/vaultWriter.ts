import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { serializeNote, parseNote, validateFrontmatter } from "./frontmatter.js";
import { atomicWrite, readWithChecksum } from "./atomicWrite.js";
import { appendDatedSectionWithArchive, initializeProjectNote } from "./projectWriter.js";
import { writeFailure } from "./sentinel.js";

const ALLOWED_EXT = new Set([".md"]);
const EXCLUDED = ["/.obsidian/", "/.git/", "/node_modules/", "/.trash/"];

export interface WriteArgs {
  frontmatter: Record<string, any>;
  body: string;
  mode: "create" | "append" | "replace";
}
export interface WriteResult { ok: boolean; reason?: string; path?: string }

function resolveSafe(rel: string): string | null {
  const root = path.resolve(vaultPath());
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (!ALLOWED_EXT.has(path.extname(abs))) return null;
  const normalized = abs.replace(/\\/g, "/");
  if (EXCLUDED.some((e) => (normalized + "/").includes(e))) return null;
  return abs;
}

const normBody = (s: string): string => s.replace(/\s+/g, " ").trim();

export function writeNote(rel: string, args: WriteArgs): WriteResult {
  const abs = resolveSafe(rel);
  if (!abs) return { ok: false, reason: "path or extension not allowed" };
  const errs = validateFrontmatter(args.frontmatter);
  if (errs.length) return { ok: false, reason: errs.join("; ") };

  if (args.mode === "replace") {
    const cur = readWithChecksum(abs);
    if (cur) {
      const prev = parseNote(cur.content);
      if (normBody(prev.content) === normBody(args.body)) return { ok: true, path: abs };
      const created = prev.data.created ?? args.frontmatter.created;
      const fm = created === undefined ? { ...args.frontmatter } : { ...args.frontmatter, created };
      atomicWrite(abs, serializeNote(fm, args.body));
      return { ok: true, path: abs };
    }
    atomicWrite(abs, serializeNote(args.frontmatter, args.body));
    return { ok: true, path: abs };
  }

  const existing = readWithChecksum(abs);

  // Project notes (projects/<slug>.md) get structured dated subsections under
  // "## Recent activity" with auto-archiving when the file exceeds 20 KB.
  const relNorm = rel.replace(/\\/g, "/");
  if (relNorm.startsWith("projects/") && !relNorm.startsWith("projects/_archive/")) {
    const stamp = new Date().toISOString().slice(0, 10);
    const date = (args.frontmatter.created as string | undefined) || stamp;
    try {
      // Determine current body (content portion only, no frontmatter)
      let currentBody: string;
      let baseFm: Record<string, any>;
      if (existing) {
        const parsed = parseNote(existing.content);
        // Dedup: skip if the normalized new body already appears in the file.
        const newNorm = normBody(args.body);
        if (newNorm.length >= 40 && normBody(parsed.content).includes(newNorm)) {
          return { ok: true, path: abs, reason: "duplicate-skipped" };
        }
        currentBody = parsed.content;
        baseFm = parsed.data;
      } else {
        const slug = path.basename(abs, ".md");
        currentBody = initializeProjectNote(slug, args.frontmatter);
        baseFm = {};
      }
      // Backfill ## Recent activity if the note pre-dates this feature
      if (
        !currentBody.includes("\n## Recent activity\n") &&
        !currentBody.endsWith("## Recent activity") &&
        !currentBody.startsWith("## Recent activity\n")
      ) {
        currentBody = currentBody.replace(/\s+$/, "") + "\n\n## Recent activity\n";
      }
      const mergedFm = { ...baseFm, ...args.frontmatter, updated: stamp };
      const fmOverhead = Buffer.byteLength(serializeNote(mergedFm, ""), "utf8");
      const r = appendDatedSectionWithArchive(currentBody, date, args.body, {
        sizeCap: Math.max(8192, (Number(process.env.SUPERBRAIN_PROJECT_NOTE_CAP_BYTES) || 32 * 1024) - fmOverhead),
      });
      // G19: write all archive sections atomically, ordered date-ascending (oldest first),
      // BEFORE the main-note atomicWrite so a crash leaves the un-trimmed main note
      // plus safe duplicate archive entries rather than losing evicted content.
      if (r.archived.length > 0) {
        const noteSlug = path.basename(abs, ".md");
        // Sort evicted sections oldest-first so archive ordering is deterministic.
        const sortedArchived = [...r.archived].sort((x, y) => x.date.localeCompare(y.date));
        // Group by archive file (year-quarter) so each file is written once atomically.
        const byArchiveFile = new Map<string, string>();
        for (const a of sortedArchived) {
          const year = a.date === "0000-00-00"
            ? new Date().toISOString().slice(0, 4)
            : a.date.slice(0, 4);
          const month = a.date === "0000-00-00"
            ? new Date().getMonth() + 1
            : parseInt(a.date.slice(5, 7), 10);
          const q = Math.ceil(month / 3);
          const archivePath = path.join(
            path.resolve(vaultPath()),
            "projects",
            "_archive",
            `${noteSlug}-${year}-Q${q}.md`,
          );
          const block = `\n### ${a.date}\n\n${a.content}\n`;
          byArchiveFile.set(archivePath, (byArchiveFile.get(archivePath) ?? "") + block);
        }
        for (const [archivePath, blocks] of byArchiveFile) {
          fs.mkdirSync(path.dirname(archivePath), { recursive: true });
          let existing_archive = "";
          if (fs.existsSync(archivePath)) {
            existing_archive = fs.readFileSync(archivePath, "utf8");
          } else {
            const yearLabel = path.basename(archivePath, ".md").match(/-(\d{4}-Q\d)$/)?.[1] ?? "";
            existing_archive = serializeNote(
              { type: "summary", project: noteSlug, archived_from: `projects/${noteSlug}.md` },
              `# ${noteSlug} - archive ${yearLabel}\n`,
            );
          }
          atomicWrite(archivePath, existing_archive + blocks);
        }
      }
      atomicWrite(abs, serializeNote(mergedFm, r.body));
      return { ok: true, path: abs };
    } catch (_e: any) {
      writeFailure(`vaultWriter fail-open fallback for ${rel}: ${(_e as any)?.message ?? String(_e)}`);
      // Fail open: fall back to legacy plain append so the distiller never crashes
      if (!existing) {
        atomicWrite(abs, serializeNote(args.frontmatter, args.body));
        return { ok: true, path: abs };
      }
      const stamp2 = new Date().toISOString().slice(0, 16).replace("T", " ");
      const parsed = parseNote(existing.content);
      const mergedFm = { ...parsed.data, ...args.frontmatter, updated: stamp2.slice(0, 10) };
      const appended = `${parsed.content.replace(/\s+$/, "")}\n\n## ${stamp2}\n\n${args.body}\n`;
      atomicWrite(abs, serializeNote(mergedFm, appended));
      return { ok: true, path: abs };
    }
  }

  if (!existing) {
    atomicWrite(abs, serializeNote(args.frontmatter, args.body));
    return { ok: true, path: abs };
  }
  // Existing file: never blind-overwrite. Append distilled body under a dated section.
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const parsed = parseNote(existing.content);
  // Dedup: the distiller can re-emit the same project_fact / gotcha across
  // adjacent runs (the model has no memory of prior emissions). Skip the
  // append if the normalized new body already appears in the file. The 40-
  // char floor avoids false positives on generic phrasing.
  const newNorm = normBody(args.body);
  if (newNorm.length >= 40 && normBody(parsed.content).includes(newNorm)) {
    return { ok: true, path: abs, reason: "duplicate-skipped" };
  }
  const mergedFm = { ...parsed.data, ...args.frontmatter, updated: stamp.slice(0, 10) };
  const appended = `${parsed.content.replace(/\s+$/, "")}\n\n## ${stamp}\n\n${args.body}\n`;
  atomicWrite(abs, serializeNote(mergedFm, appended));
  return { ok: true, path: abs };
}

export function softDelete(rel: string): WriteResult {
  const abs = resolveSafe(rel);
  if (!abs || !fs.existsSync(abs)) return { ok: false, reason: "not found" };
  const trash = path.join(path.resolve(vaultPath()), ".trash");
  fs.mkdirSync(trash, { recursive: true });
  const dest = path.join(trash, `${Date.now()}-${path.basename(abs)}`);
  fs.renameSync(abs, dest);
  return { ok: true, path: dest };
}
