import fs from "node:fs";
import path from "node:path";
import { route, type DistilledItem, slug } from "./router.js";
import { writeNote } from "./vaultWriter.js";
import { indexNote } from "./indexer.js";
import { upsertDay } from "./dailyState.js";
import { buildDailyNote } from "./dailyNote.js";
import { dataDir, vaultPath } from "./paths.js";
import { writeFailure } from "./sentinel.js";
import { hybridRecall, type Pointer } from "./recall.js";
import { parseEnvelope } from "./distillRun.js";
import { buildInjectPrompt } from "./injectPrompt.js";
import { acquireLock, releaseLock } from "./lockfile.js";
import { resolveLinks } from "./wikilink.js";
import { claudeP } from "./claudeCli.js";

export interface InjectOpts {
  verbatim?: boolean;
  distill?: boolean;
  project?: string;
}

export type SanityResult =
  | { ok: true; text: string }
  | { ok: false; code: 2 | 3; reason: string };

const MAX_INPUT_BYTES = 32 * 1024;

export function sanityCheck(raw: string): SanityResult {
  const stripped = raw.replace(/\0/g, "");
  const trimmed = stripped.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: 2, reason: "empty input" };
  }
  if (Buffer.byteLength(stripped, "utf8") > MAX_INPUT_BYTES) {
    return { ok: false, code: 2, reason: "input exceeds 32 KB" };
  }
  if (!/[a-z0-9]/i.test(trimmed)) {
    return { ok: false, code: 2, reason: "no alphanumeric content" };
  }
  return { ok: true, text: stripped };
}

export type Mode = "verbatim" | "distill";

export function detectMode(text: string, opts: InjectOpts): Mode {
  if (opts.verbatim) return "verbatim";
  if (opts.distill) return "distill";
  if (text.length > 200) return "distill";
  if (/\n\s*\n/.test(text)) return "distill";
  return "verbatim";
}

export interface InjectResult {
  ok: boolean;
  mode: Mode;
  notes: string[];
  fallback?: boolean;
  message?: string;
}

const INJECT_MARKER = "<!-- superbrain:inject ";

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function nowIso(): string { return new Date().toISOString(); }

function injectMarker(): string {
  return `${INJECT_MARKER}${todayIso()} -->`;
}

function applyInjectProvenance(
  res: ReturnType<typeof route>,
  mode: Mode,
): ReturnType<typeof route> {
  const fm = {
    ...res.frontmatter,
    source: "inject",
    injected_at: nowIso(),
    inject_mode: mode,
  };
  const body = `${injectMarker()}\n${res.body}`;
  return { ...res, frontmatter: fm, body };
}

function appendInjectLog(mode: Mode, count: number, preview: string): void {
  try {
    const stamp = nowIso().replace("T", " ").slice(0, 19);
    const safePreview = preview.replace(/\s+/g, " ").slice(0, 80);
    const line = `[${stamp}] ${mode} | ${count} notes | ${safePreview}\n`;
    fs.appendFileSync(path.join(dataDir(), "inject.log"), line);
  } catch { /* best-effort */ }
}

async function writeOne(
  item: DistilledItem,
  mode: Mode,
): Promise<string | null> {
  const routed = applyInjectProvenance(route(item), mode);
  const res = writeNote(routed.relPath, {
    frontmatter: routed.frontmatter,
    body: routed.body,
    mode: routed.mode,
  });
  if (!res.ok) return null;
  try { await indexNote(routed.relPath); } catch (e: any) {
    writeFailure(`inject index failed: ${e?.message || e}`);
  }
  return routed.relPath;
}

async function updateDaily(date: string, sid: string, routedRel: string[]): Promise<void> {
  try {
    upsertDay(date, sid, {
      digestLine: "",
      routedRelPaths: routedRel,
      alsoDid: [],
      openThreads: [],
    });
    const dn = buildDailyNote(date);
    writeNote(dn.relPath, { frontmatter: dn.frontmatter, body: dn.body, mode: dn.mode });
    try { await indexNote(dn.relPath); } catch (e: any) {
      writeFailure(`inject daily index failed: ${e?.message || e}`);
    }
  } catch (e: any) {
    writeFailure(`inject daily upsert failed: ${e?.message || e}`);
  }
}

function listProjectSlugs(): string[] {
  try {
    const dir = path.join(vaultPath(), "projects");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch { return []; }
}

function callClaudeInject(prompt: string): string {
  const stub = process.env.SUPERBRAIN_DISTILL_STUB;
  if (stub) return fs.readFileSync(stub, "utf8");
  return claudeP(prompt);
}

async function gatherRecall(text: string): Promise<Pointer[]> {
  try { return await hybridRecall(text, 5); } catch { return []; }
}

function buildVerbatimItem(text: string, opts: InjectOpts): DistilledItem {
  const date = todayIso();
  const firstLine = text.split(/\n/, 1)[0].trim();
  const title = firstLine.slice(0, 80) || "Injected note";
  if (opts.project) {
    return {
      kind: "project_fact",
      title,
      date,
      project: slug(opts.project),
      body: text.trim(),
      links: [],
    };
  }
  return { kind: "capture", title, date, body: text.trim(), links: [] };
}

function applyInjectSafety(
  items: DistilledItem[],
  knownProjects: Set<string>,
  forcedProject: string | undefined,
): DistilledItem[] {
  const out: DistilledItem[] = [];
  for (const it of items) {
    if (it.kind === "preference") continue;

    let project = it.project;
    if (forcedProject) project = slug(forcedProject);

    // Inject must never create new project notes — that's reserved for /superbrain:discover.
    if (it.kind === "project_fact" || it.kind === "gotcha") {
      const p = project ? slug(project) : undefined;
      if (!p || !knownProjects.has(p)) {
        const tag = p ? ` (project: ${p})` : "";
        out.push({
          kind: "capture",
          title: it.title,
          date: it.date,
          body: ((it.body || "") + tag).trim(),
          links: it.links,
        });
        continue;
      }
    }
    out.push({ ...it, project });
  }
  return out;
}

async function acquireDistillLockWithWait(maxWaitMs: number): Promise<boolean> {
  const start = Date.now();
  const intervalMs = 250;
  while (Date.now() - start < maxWaitMs) {
    if (acquireLock("distill")) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function runInject(raw: string, opts: InjectOpts = {}): Promise<InjectResult> {
  const sane = sanityCheck(raw);
  if (!sane.ok) return { ok: false, mode: "verbatim", notes: [], message: sane.reason };

  const waitMs = Number(process.env.SUPERBRAIN_INJECT_LOCK_WAIT_MS || 5000);
  const got = await acquireDistillLockWithWait(waitMs);
  if (!got) {
    return { ok: false, mode: "verbatim", notes: [], message: "checkpoint in progress — try again in a moment" };
  }

  try {
    const mode = detectMode(sane.text, opts);
    if (mode === "verbatim") {
      const item = buildVerbatimItem(sane.text, opts);
      const rel = await writeOne(item, "verbatim");
      if (!rel) return { ok: false, mode, notes: [], message: "vault write failed" };
      await updateDaily(item.date, `inject-${Date.now()}`, [rel]);
      appendInjectLog("verbatim", 1, sane.text);
      return { ok: true, mode, notes: [rel] };
    }

    // distill mode
    const recallHits = await gatherRecall(sane.text);
    const projectSlugs = listProjectSlugs();
    const prompt = buildInjectPrompt(sane.text, recallHits, projectSlugs);
    let envelope;
    try { envelope = parseEnvelope(callClaudeInject(prompt)); }
    catch (e: any) {
      writeFailure(`inject LLM call failed: ${e?.message || e}`);
      envelope = { items: [], openThreads: [], alsoDid: [] };
    }
    const knownProjects = new Set(projectSlugs);
    const safeItems = applyInjectSafety(envelope.items, knownProjects, opts.project);
    if (safeItems.length === 0) {
      // Fallback: never lose user input. Write the text verbatim to capture/.
      const item = buildVerbatimItem(sane.text, opts);
      const rel = await writeOne(item, "verbatim");
      if (!rel) return { ok: false, mode: "distill", notes: [], message: "vault write failed" };
      await updateDaily(item.date, `inject-${Date.now()}`, [rel]);
      appendInjectLog("verbatim", 1, sane.text);
      return { ok: true, mode: "distill", notes: [rel], fallback: true };
    }
    const written: string[] = [];
    for (const item of safeItems) {
      item.links = resolveLinks(item.links || [], vaultPath());
      const rel = await writeOne(item, "distill");
      if (rel) written.push(rel);
    }
    await updateDaily(todayIso(), `inject-${Date.now()}`, written);
    appendInjectLog("distill", written.length, sane.text);
    return { ok: written.length > 0, mode: "distill", notes: written };
  } finally {
    releaseLock("distill");
  }
}
