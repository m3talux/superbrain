import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

function file(sid: string): string {
  return path.join(dataDir(), "sessions", `${sid}.injected.json`);
}

export function getInjectedSlugs(sid: string): string[] {
  try {
    const raw = fs.readFileSync(file(sid), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

export function appendInjectedSlugs(sid: string, slugs: string[]): void {
  const existing = new Set(getInjectedSlugs(sid));
  for (const s of slugs) existing.add(s);
  const p = file(sid);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify([...existing]));
}
