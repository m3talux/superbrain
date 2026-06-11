import fs from "node:fs";
import path from "node:path";
import { distillModel } from "./model.js";
import { claudeP } from "./claudeCli.js";
export { distillModel };

function callClaude(prompt: string): string {
  return claudeP(prompt);
}

import { readDelta } from "./ndjson.js";
import { readCursor, writeCursor } from "./cursor.js";
import { route, type DistilledItem } from "./router.js";
import { writeNote } from "./vaultWriter.js";
import { acquireLock, releaseLock } from "./lockfile.js";
import { writeFailure } from "./sentinel.js";
import { vaultPath, dataDir } from "./paths.js";
import { indexNote } from "./indexer.js";
import { upsertDay } from "./dailyState.js";
import { buildDailyNote } from "./dailyNote.js";
import { preferencesPath, emitPreferencesCore } from "./preferences.js";
import { filterToUniversal } from "./preferenceClassify.js";
import { resolveLinks } from "./wikilink.js";
import { gcTranscript } from "./transcriptStore.js";
import { pruneSessionFiles } from "./sessionGc.js";
import { updateSessionNoteDigest } from "./sessionNote.js";
import { sweepPendingDistills, clearFlag, listOrphanedSessions } from "./distillSweep.js";
import { classify } from "./classification.js";
import { recordRejection } from "./rejectQueue.js";
import { type NoteType } from "./templates.js";
import { serializeNote } from "./frontmatter.js";
import { attributionFromEnv } from "./attribution.js";
import { parentSessionId, attributionFields } from "./sessionAttribution.js";
import { dedupAgainstVault } from "./distillDedup.js";
import { openIndex } from "./searchIndex.js";
import { embed } from "./embed.js";
import { classifyPath, basenameSlug } from "./projectDetect.js";
import { slug, asText } from "./router.js";
import { buildProjectIndex } from "./projectIndex.js";

export interface SessionProjectResult {
  dominant: string | undefined;
  all: string[];
}

export function resolveSessionProject(events: any[]): SessionProjectResult {
  const countBySlug: Map<string, number> = new Map();
  for (const e of events) {
    const cwd = e?.cwd;
    if (!cwd || typeof cwd !== "string") continue;
    const c = classifyPath(cwd);
    if (c.kind === "blocked" || c.kind === "skip") continue;
    const projectSlug = basenameSlug(c.projectDir);
    countBySlug.set(projectSlug, (countBySlug.get(projectSlug) ?? 0) + 1);
  }
  const all = Array.from(countBySlug.keys());
  if (all.length === 0) return { dominant: undefined, all: [] };
  let dominant = all[0];
  let maxCount = countBySlug.get(dominant) ?? 0;
  for (const [s, count] of countBySlug) {
    if (count > maxCount) { dominant = s; maxCount = count; }
  }
  return { dominant, all };
}

function shortTitle(raw: string, fallbackBody: string): string {
  const src = (asText(raw) || asText(fallbackBody)).trim();
  const words = src.split(/\s+/).filter(Boolean);
  const taken = words.slice(0, 8).join(" ").replace(/\.+$/, "");
  return taken || "Captured note";
}

function countBodyWords(body: string): number {
  return body
    .replace(/^---[\s\S]*?\n---\n?/m, "")
    .replace(/^#+ .*$/gm, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

function trimToWordCeiling(text: string, ceiling: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= ceiling) return text;
  return words.slice(0, ceiling).join(" ");
}

export function coerceCapture(item: DistilledItem, routedBody: string): string {
  const title = shortTitle(asText(item.title), asText(item.body));
  const rawBody = (asText(item.body) || asText(routedBody)).trim();
  const words = rawBody.split(/\s+/).filter(Boolean);
  const maxWhat = 180;
  const whatContent = words.length > maxWhat
    ? words.slice(0, maxWhat).join(" ") + " …"
    : rawBody;
  const lastSentence = rawBody.split(/[.!?](?:\s|$)/).filter(Boolean).pop()?.trim() || rawBody.slice(0, 100);
  const whyContent = lastSentence.replace(/\.+$/, "").slice(0, 120);
  return `# ${title}\n\n## What\n\n${whatContent}\n\n## Why it matters\n\n${whyContent}\n`;
}

export function coerceLesson(item: DistilledItem, routedBody: string): string {
  const title = (asText(item.title) || "Lesson").trim();
  const ruleText = asText(item.rule).trim() || trimToWordCeiling((asText(item.body) || asText(routedBody)).trim(), 30);
  const whyText = (asText(item.why) || asText(item.body) || asText(routedBody)).trim() || "See session context.";
  const whenText = asText(item.whenApplies).trim() || "In relevant future situations.";
  return `# ${title}\n\n## Rule\n\n${ruleText}\n\n## Why\n\n${whyText}\n\n## When this applies\n\n${whenText}\n`;
}

export interface DistilledEnvelope {
  items: DistilledItem[];
  digest?: string;
  openThreads: string[];
  alsoDid: string[];
}

export function parseEnvelope(raw: string): DistilledEnvelope {
  let v: any;
  try {
    const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    v = JSON.parse(m ? m[0] : raw);
  } catch { return { items: [], openThreads: [], alsoDid: [] }; }
  if (Array.isArray(v)) return { items: v as DistilledItem[], openThreads: [], alsoDid: [] };
  return {
    items: Array.isArray(v.items) ? v.items as DistilledItem[] : [],
    digest: typeof v.digest === "string" ? v.digest : undefined,
    openThreads: Array.isArray(v.openThreads) ? v.openThreads : [],
    alsoDid: Array.isArray(v.alsoDid) ? v.alsoDid : [],
  };
}

// The session-distillation prompt. Long and opinionated on purpose: prompt
// quality is the whole game. Structure: persona → hard rules → per-kind
// emission criteria → per-kind required fields → few-shot examples →
// preferences reconciliation contract → output schema → events.
const DISTILL_PROMPT_PREFIX = `You are SuperBrain's distiller. You receive a JSON array of session events (tool calls, prompts) plus 'pushback' markers, and you turn the substantive moments into durable second-brain notes. Many sessions contain NO substantive moments — that is the desired output, not a failure.

# Hard rules — never violate

1. If the events array is empty OR contains no substantive activity (skim-only sessions, observer-watches-observer meta-sessions, sessions that only read existing notes), output {"items":[]} immediately and stop.
2. Distiller behavior rules (this prompt) are NOT user preferences. NEVER write them into a preference item.
3. Skip transcript dumps and anything trivially derivable from git or the code itself (file paths, function names, commit messages alone are not knowledge).
4. Output ONLY the JSON envelope. No prose, no backticks, no explanation.
5. The "links" array must reference EXISTING notes by their on-disk relative path WITHOUT the .md suffix (e.g. "projects/superbrain", "decisions/2026-05-19-pin-distiller-model-to-sonnet-4-6"). Do NOT invent short conceptual slugs like "jarvis-vision" or "architecture-decision" — unresolved links are dropped at write time, so a wrong link is the same as no link. If you are unsure a target note exists, omit it.

# Quality bar — wait for signal before emitting

Each kind has a concrete threshold. If a session does not meet the threshold for any kind, do not invent items. Empty output is correct.

- decision — emit only when the session contains an EXPLICIT deliberation (multiple options weighed and a trade-off chosen) OR a documented multi-step plan with stated reasoning. A one-line conclusion is not a decision.
- gotcha — emit only when a bug was REPRODUCED AND DIAGNOSED AND has a stated fix or workaround. Speculation, suspicion, or 'this might be the issue' is not a gotcha.
- lesson — emit only when user pushback produces a GENERALIZABLE RULE that should change future behavior. A one-off correction ('not that file, the other one') is not a lesson.
- project_fact — emit only for DURABLE architectural, scope, or ownership statements. 'PR in review' is not a project fact. 'We've decided this service will be the only writer for X' is.
- preference — emit only when the user EXPLICITLY states a coding / tooling / communication preference, OR sustained pushback reveals one. Preferences describe how the USER wants Claude to behave (code style, architecture, tool choice, comment density, etc.). NEVER describe SuperBrain's own distiller behavior here.
- person — emit only when a durable role / context / thread about a specific person is established.
- capture — only for substantive items that don't fit above but are clearly worth keeping. Not a dumping ground.

# Required fields per kind — write rich, structured notes

When you DO emit, fill the structured fields below. Substance over brevity: a real decision note is paragraphs, not a sentence.

decision: { kind, title (imperative, ≤80 chars), date, decision (1–2 sentences: the chosen path, imperative tense), why (bullets: the constraint or evidence that forced the choice), alternatives (one or more "- **Name** — rejection reason" bullets), consequences (1 paragraph: what this enables, forecloses, or requires watching for), project? (slug if scoped), links (related-note slugs) }

gotcha: { kind, title (short symptom name), date, project (slug — required), symptom (the observable failure), rootCause (technical explanation), fix (what resolves it, with file refs if possible), prevention (how to avoid hitting it again), links }

lesson: { kind, title (short imperative rule name), date, rule (the durable, generalizable principle, one crisp sentence — REQUIRED), why (the reasoning + the incident that produced it, 1–2 paragraphs — REQUIRED; ALWAYS use this structured field, never a freeform body), whenApplies (when to invoke this rule in the future — REQUIRED), links }

project_fact: { kind, title (short fact statement), date, project (slug — required), body (one sentence of context + the fact itself; ≤3 sentences), links }

person: { kind, title (short), date, person (slug — required), body (role/context/threads), links }

preference: { kind, title: "Preferences", date, body (the FULL reconciled user-preferences doc — plain markdown, organized by '## Category' headings such as Code style / Architecture / Tools / Communication, NEVER containing SuperBrain distiller behavior) }

capture: { kind, title (≤8 words, no trailing period — scannable noun phrase, not a sentence), date, what (one paragraph: the fact, tool, or event worth keeping), whyItMatters (1–2 sentences: why it is worth keeping), links }

# Preferences reconciliation

You are given the current preferences doc at the end of this prompt. When a lesson's rule qualifies as a user-style/tool/communication preference (NOT a SuperBrain behavior rule), ALSO emit exactly one preference item whose body is the FULL reconciled doc — integrate the new rule, dedupe, resolve contradictions newest-wins, keep '## Category' headings. Never emit more than one preference item per envelope. If the lesson is a SuperBrain behavior rule, do not emit a preference at all.

# Few-shot — what a substantive decision and lesson look like

EXAMPLE decision (structured fields filled, paragraphs, links):
{"kind":"decision","title":"Pin distiller model to Sonnet 4.6","date":"2026-05-19","decision":"Hardcode the distiller and rollup spawns to use --model claude-sonnet-4-6 unconditionally; no env override.","why":"- Sonnet 4.6 produces judgment of comparable quality to Opus for summarization at roughly 1/5 the cost.\n- The legacy scribe ran detached claude -p spawns at the user's session model (often Opus), burning the daily Opus quota in hours and causing silent capture failures mid-day.\n- Removing the env override prevents users from accidentally re-introducing the quota burn — the surface area was a footgun, not a feature.","alternatives":"- **Session model passthrough** — rejected because it burned Opus quota silently within hours.\n- **Env-override flag** — rejected because users would accidentally re-enable the expensive path.","consequences":"Users who want higher quality must set ANTHROPIC_API_KEY to bypass subscription quota. No model selection is exposed beyond that escape hatch.","links":["projects/superbrain"]}

EXAMPLE lesson (structured fields, traced to an incident, with whenApplies):
{"kind":"lesson","title":"Verify the live data dir before claiming a plugin is broken","date":"2026-05-20","rule":"For Claude Code plugins, resolve the actual CLAUDE_PLUGIN_DATA path at hook execution time before inspecting on-disk state — never trust the fallback path in the source code.","why":"On 2026-05-20 a full multi-step misdiagnosis was produced (broken matchers, async hook failure, missing distillation) because the investigator inspected the source's fallback ~/.superbrain/ instead of the actual ~/.claude/plugins/data/superbrain-m3talux/ where Claude Code routes hook writes. Everything was healthy at the real path.","whenApplies":"Any time a Claude Code plugin appears to not be writing data, before declaring it broken.","links":["projects/superbrain"]}

# Output schema

{"items": [ <items as above> ], "digest"?: "<=1 sentence of the session's arc", "openThreads"?: ["unfinished/deferred work"], "alsoDid"?: ["notable work that did not become a knowledge item"]}

# Multi-repo sessions

When the events span more than one repo (multiple distinct cwd values), set each item's "project" to the repo its work belongs to — the events carry cwd so the correct repo is usually clear. Do not leave "project" unset when the repo is identifiable from the events. A wrong label is worse than a null one, so if the item's repo is genuinely ambiguous, omit "project" rather than guessing.

# Events

`;

function getEnvelope(deltaJson: string): DistilledEnvelope {
  const stub = process.env.SUPERBRAIN_DISTILL_STUB;
  if (stub) return parseEnvelope(fs.readFileSync(stub, "utf8"));
  let curPrefs = "";
  try { curPrefs = fs.readFileSync(preferencesPath(), "utf8"); } catch { /* none yet */ }
  const fullPrompt =
    DISTILL_PROMPT_PREFIX +
    deltaJson +
    "\n\n# Current preferences (reconcile, do not lose existing user preferences; never include distiller behavior here)\n\n" +
    (curPrefs || "(none yet)");
  const out = callClaude(fullPrompt);
  return parseEnvelope(out);
}




// Cost optimization: skip the claude -p spawn entirely when the session
// delta has too little signal to be worth distilling. Reads the same NDJSON
// the distiller would have sent and decides locally — no LLM call. Saves
// ~5K input tokens per low-signal session. Conservative on the skip side:
// only declines when no salience markers AND no file writes AND <2 prompts
// AND <10 total events. Anything ambiguous still distills.
export interface SkipResult { skip: boolean; reason: string; }
export function shouldSkipDistill(events: any[]): SkipResult {
  if (!events || events.length === 0) return { skip: true, reason: "empty delta" };
  const markers = events.filter(e => e?.type === "marker" || e?.reason);
  const writeTools = events.filter(e => e?.type === "tool" && ["Write", "Edit", "MultiEdit", "Bash"].includes(e?.tool));
  const prompts = events.filter(e => e?.type === "prompt");
  if (markers.length === 0 && writeTools.length === 0 && prompts.length < 2 && events.length < 10) {
    return {
      skip: true,
      reason: `low-signal delta: ${events.length} events, ${writeTools.length} writes, ${prompts.length} prompts, 0 markers`,
    };
  }
  return { skip: false, reason: "" };
}

// Append a one-line trace to ~/.superbrain/distill.log on every distill
// decision. Lets the user see exactly when the skip fired and why, without
// burdening the sentinel (which is reserved for actual failures).
function logDistillSkip(sid: string, reason: string): void {
  try {
    const logFile = path.join(dataDir(), "distill.log");
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    fs.appendFileSync(logFile, `[${stamp}] skip ${sid}: ${reason}\n`);
  } catch { /* best-effort */ }
}

export interface DistillEventsResult {
  notesWritten: number;
}

export function readKnownProjectSlugs(vault: string): Set<string> {
  const override = process.env.SUPERBRAIN_KNOWN_SLUGS_OVERRIDE;
  if (override !== undefined) {
    return new Set(override.split(",").map(s => s.trim()).filter(Boolean).map(s => slug(s)));
  }
  const projectsDir = path.join(vault, "projects");
  const slugs = new Set<string>();
  try {
    for (const entry of fs.readdirSync(projectsDir)) {
      if (entry.endsWith(".md") && !entry.startsWith("_")) {
        slugs.add(slug(entry.slice(0, -3)));
      }
    }
  } catch { /* projects dir absent */ }
  return slugs;
}

export async function distillFromEvents(sid: string, events: any[]): Promise<DistillEventsResult> {
  const attribution = attributionFromEnv();
  const env = getEnvelope(JSON.stringify(events));
  const sessionProj = resolveSessionProject(events);
  const parent = parentSessionId();
  const PROJECT_SCOPED_KINDS = new Set<string>(["project_fact", "gotcha", "decision", "capture"]);
  const items = env.items;
  const routedByDate: Record<string, string[]> = {};
  let notesWritten = 0;
  const touchedProjects = new Set<string>();
  for (const it of items) {
    try {
      if (!it.project && PROJECT_SCOPED_KINDS.has(it.kind) && sessionProj.all.length === 1 && sessionProj.dominant) {
        it.project = sessionProj.dominant;
      } else if (it.project) {
        it.project = slug(it.project);
      }
      it.links = resolveLinks(it.links || [], vaultPath());
      if (it.kind === "preference") {
        const knownSlugs = readKnownProjectSlugs(vaultPath());
        const { universalBody, demoted } = filterToUniversal(it.body ?? "", knownSlugs);
        it.body = universalBody;
        for (const d of demoted) {
          if (d.projectSlug) {
            const projRelPath = `projects/${d.projectSlug}.md`;
            if (!fs.existsSync(path.join(vaultPath(), projRelPath))) {
              recordRejection(vaultPath(), { type: "preference", reason: `project note missing: ${projRelPath}`, sessionId: sid, title: it.title, excerpt: d.text.slice(0, 200) });
              continue;
            }
            writeNote(projRelPath, {
              frontmatter: { type: "project", status: "active", project: d.projectSlug, created: it.date, updated: it.date, superbrain: true },
              body: `**${d.text}**`,
              mode: "append",
            });
          } else {
            recordRejection(vaultPath(), { type: "preference", reason: "project-scoped rule with unresolvable slug", sessionId: sid, title: it.title, excerpt: d.text.slice(0, 200) });
          }
        }
        if (!universalBody.trim()) continue;
      }
      const r = route(it);
      if (r.mode !== "create") {
        const res0 = writeNote(r.relPath, { frontmatter: { ...r.frontmatter, ...attribution, ...attributionFields() }, body: r.body, mode: r.mode });
        if (res0.ok && res0.reason !== "duplicate-skipped") {
          try { await indexNote(r.relPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
          (routedByDate[it.date] ||= []).push(r.relPath);
          notesWritten++;
          if (it.project) touchedProjects.add(it.project);
          const projMatch = r.relPath.match(/^projects\/([^/_][^/]*)\.md$/);
          if (projMatch) touchedProjects.add(slug(projMatch[1]));
          if (it.kind === "preference") {
            try { emitPreferencesCore(it.body ?? ""); } catch { /* best-effort */ }
          }
        }
        continue;
      }
      {
        let vaultDedupSkip = false;
        try {
          const vaultSearchFn = async (
            query: string,
            _opts?: { k?: number; type?: string; project?: string },
          ): Promise<Array<{ path: string; score: number }>> => {
            let ix;
            try {
              ix = openIndex();
              const [qv] = await embed([query]);
              const hits = ix.vectorKNN(qv, 1);
              if (!hits.length) return [];
              const [hv] = await embed([hits[0].text]);
              let dot = 0, na = 0, nb = 0;
              const n = Math.min(qv.length, hv.length);
              for (let i = 0; i < n; i++) { dot += qv[i] * hv[i]; na += qv[i] ** 2; nb += hv[i] ** 2; }
              const sim = (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
              return [{ path: hits[0].relPath, score: sim }];
            } catch { return []; }
            finally { ix?.close(); }
          };
          const vaultMatch = await dedupAgainstVault(
            { title: it.title, body: r.body, project: it.project, type: r.frontmatter.type as string | undefined },
            vaultSearchFn,
          );
          if (vaultMatch.match) {
            recordRejection(vaultPath(), {
              type: r.frontmatter.type as string ?? it.kind,
              reason: `dedup vs ${vaultMatch.match} (score ${vaultMatch.score?.toFixed(2)})`,
              sessionId: sid,
              title: it.title,
              excerpt: r.body.slice(0, 500),
            });
            vaultDedupSkip = true;
          }
        } catch (e: any) {
          writeFailure(`vault dedup error: ${e?.message || e}`);
        }
        if (vaultDedupSkip) continue;
      }
      const classifiableKinds = new Set<string>(["decision", "lesson", "capture", "project", "daily", "person"]);
      let writeBody = r.body;
      let writeRelPath = r.relPath;
      let writeFrontmatter = r.frontmatter;
      if (classifiableKinds.has(it.kind)) {
        try {
          const classifyFm = it.project
            ? { ...r.frontmatter, project: it.project }
            : r.frontmatter;
          const candidateDoc = serializeNote(classifyFm, r.body);
          const cr = classify({ proposedType: it.kind as NoteType, title: it.title, body: candidateDoc });
          if (!cr.accepted) {
            recordRejection(vaultPath(), {
              type: it.kind,
              reason: `coerced (was: ${cr.reason ?? "rejected by classifier"})`,
              sessionId: sid,
              title: it.title,
              excerpt: candidateDoc.slice(0, 500),
            });
            const targetKind = cr.suggestedType ?? (it.kind as NoteType);
            if (targetKind === "lesson") {
              const reItem: DistilledItem = { ...it, kind: "lesson" };
              const r2 = route(reItem);
              writeFrontmatter = r2.frontmatter;
              writeRelPath = r2.relPath;
              writeBody = coerceLesson(reItem, r.body);
            } else {
              const reItem: DistilledItem = { ...it, kind: "capture", title: shortTitle(it.title, it.body || "") };
              const r2 = route(reItem);
              writeFrontmatter = r2.frontmatter;
              writeRelPath = r2.relPath;
              writeBody = coerceCapture(reItem, r.body);
            }
          }
        } catch (e: any) {
          writeFailure(`classify failed for '${it.title}': ${e?.message || e}`);
        }
      }
      const res = writeNote(writeRelPath, { frontmatter: { ...writeFrontmatter, ...attribution, ...attributionFields() }, body: writeBody, mode: r.mode });
      if (res.ok && res.reason !== "duplicate-skipped") {
        try { await indexNote(writeRelPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
        (routedByDate[it.date] ||= []).push(writeRelPath);
        notesWritten++;
        if (it.project) touchedProjects.add(it.project);
        const projMatch2 = writeRelPath.match(/^projects\/([^/_][^/]*)\.md$/);
        if (projMatch2) touchedProjects.add(slug(projMatch2[1]));
      }
    } catch (e: any) {
      recordRejection(vaultPath(), {
        type: asText((it as any)?.kind) || "unknown",
        reason: `item dropped (routing error): ${e?.message || e}`,
        sessionId: sid,
        title: asText((it as any)?.title),
        excerpt: asText((it as any)?.body).slice(0, 500),
      });
      writeFailure(`item dropped: ${e?.message || e}`);
    }
  }
  for (const projSlug of touchedProjects) {
    try {
      const { relPath: idxRelPath, changed } = buildProjectIndex(projSlug);
      if (changed) {
        try { await indexNote(idxRelPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
      }
    } catch (e: any) { writeFailure(`project index build failed for '${projSlug}': ${e?.message || e}`); }
  }
  try {
    const dates = Object.keys(routedByDate);
    const today = new Date().toISOString().slice(0, 10);
    for (const d of dates.length ? dates : [today]) {
      upsertDay(d, sid, {
        digestLine: env.digest || "",
        routedRelPaths: routedByDate[d] || [],
        alsoDid: env.alsoDid,
        openThreads: env.openThreads,
        ...(sessionProj.dominant !== undefined ? { project: sessionProj.dominant } : {}),
        ...(sessionProj.all.length > 1 ? { projects: sessionProj.all } : {}),
        ...(parent !== undefined ? { parentSessionId: parent } : {}),
      });
      const dn = buildDailyNote(d);
      writeNote(dn.relPath, { frontmatter: dn.frontmatter, body: dn.body, mode: dn.mode });
      try { await indexNote(dn.relPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
    }
  } catch (e: any) { writeFailure(`daily note failed: ${e?.message || e}`); }
  try {
    updateSessionNoteDigest(sid, env.digest || "", Object.values(routedByDate).flat());
  } catch (e: any) { writeFailure(`session note digest failed: ${e?.message || e}`); }
  return { notesWritten };
}

async function distillSession(sid: string): Promise<void> {
  const from = readCursor(sid);
  const { events, newOffset } = readDelta(sid, from);
  if (events.length === 0) { writeCursor(sid, newOffset); return; }
  if (!process.env.SUPERBRAIN_DISTILL_STUB) {
    const sk = shouldSkipDistill(events);
    if (sk.skip) { logDistillSkip(sid, sk.reason); writeCursor(sid, newOffset); return; }
  }
  await distillFromEvents(sid, events);
  writeCursor(sid, newOffset);
}

export async function runDistill(): Promise<void> {
  const sid = process.env.SUPERBRAIN_SESSION_ID
    || (() => { try { return JSON.parse(fs.readFileSync(0, "utf8")).session_id; } catch { return "unknown"; } })();
  try {
    await distillSession(sid);
    clearFlag(sid);
    try { gcTranscript(path.join(dataDir(), "transcripts"), sid); } catch { /* best-effort */ }
    try { await sweepPendingDistills(sid, distillSession); } catch (e: any) { writeFailure(`sweep failed: ${e?.message || e}`); }
    try { pruneSessionFiles(dataDir()); } catch { /* best-effort */ }
  } catch (e: any) {
    writeFailure(`distill failed: ${e?.message || e}`);
  } finally {
    releaseLock("distill", process.env.SUPERBRAIN_LOCK_TOKEN);
  }
}

export async function sweepOrphanedSessions(excludeSid: string): Promise<number> {
  const orphans = listOrphanedSessions(excludeSid);
  if (!orphans.length) return 0;
  if (!acquireLock("distill")) return 0;
  let token: string | undefined;
  try { token = fs.readFileSync(path.join(dataDir(), "locks", "distill.lock", "token"), "utf8"); } catch { /* best-effort */ }
  let swept = 0;
  try {
    for (const sid of orphans) {
      try {
        await distillSession(sid);
        clearFlag(sid);
        swept++;
      } catch (e: any) {
        writeFailure(`orphan distill failed for ${sid}: ${e?.message || e}`);
      }
    }
  } finally {
    releaseLock("distill", token);
  }
  return swept;
}
