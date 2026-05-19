import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

export const MARKER = ".superbrain";

export function isOwned(dir: string): boolean {
  try { return fs.existsSync(path.join(dir, MARKER)); } catch { return false; }
}

export function markOwned(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MARKER), "superbrain-owned\n");
}

function recordFile(): string { return path.join(dataDir(), "vault-path"); }

export function recordedVaultPath(): string | undefined {
  try { const p = fs.readFileSync(recordFile(), "utf8").trim(); return p || undefined; }
  catch { return undefined; }
}

export function setRecordedVaultPath(p: string): void {
  fs.mkdirSync(path.dirname(recordFile()), { recursive: true });
  fs.writeFileSync(recordFile(), p);
}
