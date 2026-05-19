import fs from "node:fs";
import path from "node:path";
import { rollupStatePath } from "./paths.js";

type Kind = "daily" | "weekly" | "monthly";
function load(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(rollupStatePath(), "utf8")); } catch { return {}; }
}
function save(s: Record<string, string>): void {
  const p = rollupStatePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
}
export function needsRollup(kind: Kind, key: string, sourceHash: string): boolean {
  return load()[`${kind}:${key}`] !== sourceHash;
}
export function markRollup(kind: Kind, key: string, sourceHash: string): void {
  const s = load(); s[`${kind}:${key}`] = sourceHash; save(s);
}
