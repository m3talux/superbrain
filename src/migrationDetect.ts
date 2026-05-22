import fs from "node:fs";
import path from "node:path";

export interface LegacyState {
  frontmatterMissing: number;   // notes missing type or project field
  edgesEmpty: boolean;          // vault_edges table empty or absent
  preferencesOverCap: boolean;  // meta/preferences.md > 5 KB
  totalLegacyNotes: number;     // sum signal: any > 0 means migration recommended
}

// Folders to scan for missing frontmatter (skip daily, projects, meta, _archive)
const SCAN_FOLDERS = ["decisions", "lessons", "capture", "people"];

/**
 * Fast frontmatter check: look only for type: and project: lines in the
 * opening --- block. Avoids full YAML parse for speed (<200ms on 400 notes).
 */
function hasFrontmatterFields(raw: string): { hasType: boolean; hasProject: boolean } {
  if (!raw.startsWith("---")) return { hasType: false, hasProject: false };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { hasType: false, hasProject: false };
  const block = raw.slice(0, end);
  return {
    hasType: /^type:/m.test(block),
    hasProject: /^project:/m.test(block),
  };
}

/**
 * Count notes in the given vault folders that are missing type: or project:.
 * Uses streaming reads — reads only enough bytes to cover the frontmatter block.
 */
function countFrontmatterMissing(vaultDir: string): number {
  let missing = 0;
  for (const folder of SCAN_FOLDERS) {
    const dir = path.join(vaultDir, folder);
    if (!fs.existsSync(dir)) continue;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
      const fullPath = path.join(dir, ent.name);
      try {
        // Read up to 2KB — enough for any realistic frontmatter block
        const buf = Buffer.alloc(2048);
        const fd = fs.openSync(fullPath, "r");
        const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
        fs.closeSync(fd);
        const snippet = buf.slice(0, bytesRead).toString("utf8");
        const { hasType, hasProject } = hasFrontmatterFields(snippet);
        // People notes don't get project field — only check type for them
        const folderName = folder;
        const needsProject = folderName !== "people";
        if (!hasType || (needsProject && !hasProject)) {
          missing++;
        }
      } catch { /* skip unreadable files */ }
    }
  }
  return missing;
}

/**
 * Check if vault_edges table is absent or empty in the SQLite DB.
 * Uses dynamic import so callers stay import-safe.
 */
async function checkEdgesEmpty(dbPath: string): Promise<boolean> {
  if (!fs.existsSync(dbPath)) return true;
  try {
    const { default: Database } = await import("better-sqlite3") as any;
    const db = new Database(dbPath, { readonly: true });
    try {
      // Check table exists
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='vault_edges'"
      ).get();
      if (!tableExists) return true;
      const row = db.prepare("SELECT COUNT(*) as cnt FROM vault_edges").get() as { cnt: number };
      return row.cnt === 0;
    } finally {
      db.close();
    }
  } catch {
    return true;
  }
}

/**
 * Detect legacy vault state for migration UX.
 * Synchronous except for the SQLite check which is async.
 */
export async function detectLegacyState(vaultDir: string, dbPath: string): Promise<LegacyState> {
  const frontmatterMissing = fs.existsSync(vaultDir)
    ? countFrontmatterMissing(vaultDir)
    : 0;

  const edgesEmpty = await checkEdgesEmpty(dbPath);

  let preferencesOverCap = false;
  try {
    const prefsPath = path.join(vaultDir, "meta", "preferences.md");
    if (fs.existsSync(prefsPath)) {
      const size = fs.statSync(prefsPath).size;
      preferencesOverCap = size > 5 * 1024; // 5 KB
    }
  } catch { /* best-effort */ }

  const totalLegacyNotes =
    frontmatterMissing +
    (edgesEmpty ? 1 : 0) +
    (preferencesOverCap ? 1 : 0);

  return { frontmatterMissing, edgesEmpty, preferencesOverCap, totalLegacyNotes };
}
