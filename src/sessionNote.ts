import fs from "node:fs";
import path from "node:path";
import { sessionsDir, vaultPath } from "./paths.js";
import { resolveProjectSlug } from "./sessionProject.js";

const TURN_LOG_CAP_BYTES = 64 * 1024;
const LINE_MAX = 200;
const TURN_LOG_MARKER = "## Turn log\n";

export function notePointerPath(sid: string): string {
  return path.join(sessionsDir(), `${sid}.note`);
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function hhmm(): string { return new Date().toTimeString().slice(0, 5); }

function oneLine(text: string, max = LINE_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function safeSlug(cwd: string): string | undefined {
  try { return resolveProjectSlug(cwd); } catch { return undefined; }
}

function skeleton(sid: string, slug: string | undefined): string {
  const head = slug
    ? `# Session ${sid.slice(0, 8)} — [[projects/${slug}]]`
    : `# Session ${sid.slice(0, 8)}`;
  const fm = [
    "---",
    "type: session",
    `session: ${sid}`,
    ...(slug ? [`project: ${slug}`] : []),
    `created: ${today()}`,
    `updated: ${today()}`,
    "superbrain: true",
    "---",
  ].join("\n");
  return `${fm}\n\n${head}\n\n## Digest\n\n(no checkpoint yet)\n\n## Notes routed\n\n${TURN_LOG_MARKER}`;
}

function ensureNote(sid: string, cwd: string): string {
  const ptr = notePointerPath(sid);
  let rel = "";
  try { rel = fs.readFileSync(ptr, "utf8").trim(); } catch { /* no pointer yet */ }
  let slug: string | undefined;
  if (!rel) {
    slug = safeSlug(cwd);
    rel = path.join("sessions", `${slug || "unscoped"}-${Math.floor(Date.now() / 1000)}.md`);
    fs.mkdirSync(path.dirname(ptr), { recursive: true });
    fs.writeFileSync(ptr, rel);
  }
  const abs = path.join(vaultPath(), rel);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, skeleton(sid, slug ?? safeSlug(cwd)));
  }
  return abs;
}

function trimTurnLog(abs: string): void {
  let raw: string;
  try { raw = fs.readFileSync(abs, "utf8"); } catch { return; }
  if (Buffer.byteLength(raw, "utf8") <= TURN_LOG_CAP_BYTES) return;
  const i = raw.indexOf(TURN_LOG_MARKER);
  if (i < 0) return;
  const head = raw.slice(0, i + TURN_LOG_MARKER.length);
  const lines = raw.slice(i + TURN_LOG_MARKER.length).split("\n");
  while (lines.length > 1 && Buffer.byteLength(head + lines.join("\n"), "utf8") > TURN_LOG_CAP_BYTES) {
    lines.shift();
  }
  fs.writeFileSync(abs, head + lines.join("\n"));
}

export function appendPromptLine(sid: string, cwd: string, prompt: string): void {
  if (!sid || !prompt.trim()) return;
  const abs = ensureNote(sid, cwd);
  fs.appendFileSync(abs, `- ${hhmm()} ▸ ${oneLine(prompt)}\n`);
  trimTurnLog(abs);
}

export function appendAssistantTail(sid: string, cwd: string, text: string): void {
  if (!sid || !text.trim()) return;
  const abs = ensureNote(sid, cwd);
  fs.appendFileSync(abs, `  ↳ ${oneLine(text)}\n`);
  trimTurnLog(abs);
}

export function updateSessionNoteDigest(sid: string, digest: string, routedRelPaths: string[]): void {
  let rel: string;
  try { rel = fs.readFileSync(notePointerPath(sid), "utf8").trim(); } catch { return; }
  if (!rel) return;
  const abs = path.join(vaultPath(), rel);
  let raw: string;
  try { raw = fs.readFileSync(abs, "utf8"); } catch { return; }
  if (digest.trim()) {
    const dMarker = "## Digest\n";
    const di = raw.indexOf(dMarker);
    if (di >= 0) {
      const start = di + dMarker.length;
      const end = raw.indexOf("\n## ", start);
      const tail = end < 0 ? "" : raw.slice(end);
      raw = raw.slice(0, start) + `\n${oneLine(digest, 400)}\n` + tail;
    }
  }
  const marker = "## Notes routed\n";
  const i = raw.indexOf(marker);
  if (i >= 0 && routedRelPaths.length) {
    const insertAt = i + marker.length;
    const end = raw.indexOf("\n## ", insertAt);
    const existing = end < 0 ? raw.slice(insertAt) : raw.slice(insertAt, end);
    const fresh = routedRelPaths
      .map((p) => `- [[${p.replace(/\.md$/, "")}]]`)
      .filter((l) => !existing.includes(l));
    if (fresh.length) raw = raw.slice(0, insertAt) + fresh.join("\n") + "\n" + raw.slice(insertAt);
  }
  raw = raw.replace(/^updated: .*$/m, `updated: ${today()}`);
  fs.writeFileSync(abs, raw);
}
