import fs from "node:fs";
import path from "node:path";
import { softDelete } from "./vaultWriter.js";
import { vaultPath } from "./paths.js";

export interface SessionGcOptions {
  maxAgeDays?: number;
  dryRun?: boolean;
}

export interface SessionGcResult {
  deleted: string[];
  skipped: number;
  errors: string[];
}

const KNOWN_EXTENSIONS = new Set([
  ".ndjson",
  ".cursor",
  ".pending",
  ".needs-distill",
  ".note",
  ".salience.json",
  ".injected.json",
  ".turns.json",
]);

function sessionExtension(filename: string): string | undefined {
  for (const ext of KNOWN_EXTENSIONS) {
    if (filename.endsWith(ext)) return ext;
  }
  return undefined;
}

function sessionIdFromFilename(filename: string, ext: string): string {
  return filename.slice(0, filename.length - ext.length);
}

export function pruneSessionFiles(
  dataDirPath: string,
  opts?: SessionGcOptions,
): SessionGcResult {
  const maxAgeDays = opts?.maxAgeDays ?? 30;
  const dryRun = opts?.dryRun ?? false;
  const result: SessionGcResult = { deleted: [], skipped: 0, errors: [] };

  const sd = path.join(dataDirPath, "sessions");
  let entries: string[];
  try {
    entries = fs.readdirSync(sd);
  } catch {
    return result;
  }

  const nowMs = Date.now();
  const thresholdMs = maxAgeDays * 24 * 60 * 60 * 1000;

  // Group files by session ID, only keeping files with known extensions
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const ext = sessionExtension(entry);
    if (!ext) continue;
    const sid = sessionIdFromFilename(entry, ext);
    const list = groups.get(sid) ?? [];
    list.push(entry);
    groups.set(sid, list);
  }

  for (const [, files] of groups) {
    // All-or-nothing: only prune a group if ALL files exceed the age threshold
    let allOld = true;
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(sd, f));
        const ageMs = nowMs - stat.mtimeMs;
        if (ageMs < thresholdMs) {
          allOld = false;
          break;
        }
      } catch {
        allOld = false;
        break;
      }
    }
    if (!allOld) {
      result.skipped += files.length;
      continue;
    }
    // Delete the group
    for (const f of files) {
      const fp = path.join(sd, f);
      if (dryRun) {
        result.deleted.push(fp);
      } else {
        try {
          fs.unlinkSync(fp);
          result.deleted.push(fp);
        } catch (e: any) {
          result.errors.push(`${fp}: ${e?.message ?? String(e)}`);
        }
      }
    }
  }

  return result;
}

export function pruneSessionNotes(opts?: SessionGcOptions): SessionGcResult {
  const maxAgeDays = opts?.maxAgeDays ?? 30;
  const dryRun = opts?.dryRun ?? false;
  const result: SessionGcResult = { deleted: [], skipped: 0, errors: [] };
  const dir = path.join(vaultPath(), "sessions");
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return result; }
  const nowMs = Date.now();
  const thresholdMs = maxAgeDays * 24 * 60 * 60 * 1000;
  for (const f of entries) {
    if (!f.endsWith(".md")) continue;
    const fp = path.join(dir, f);
    try {
      const stat = fs.statSync(fp);
      if (nowMs - stat.mtimeMs < thresholdMs) { result.skipped++; continue; }
      if (dryRun) { result.deleted.push(fp); continue; }
      const res = softDelete(path.join("sessions", f));
      if (res.ok) result.deleted.push(fp);
      else result.errors.push(`${fp}: ${res.reason}`);
    } catch (e: any) {
      result.errors.push(`${fp}: ${e?.message ?? String(e)}`);
    }
  }
  return result;
}
