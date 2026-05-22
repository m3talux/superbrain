import { openIndex, rrfWithScores, type Hit, type Index } from "./searchIndex.js";
import { embed } from "./embed.js";

export interface Pointer { relPath: string; headingPath: string; anchor: string; excerpt: string; }

function toPointers(hits: Hit[]): Pointer[] {
  return hits.map((h) => ({
    relPath: h.relPath, headingPath: h.headingPath, anchor: h.anchor,
    excerpt: h.text.replace(/\s+/g, " ").trim().slice(0, 160),
  }));
}
const keyOf = (h: Hit) => `${h.relPath}#${h.anchor}`;

export async function bm25Recall(query: string, k: number): Promise<Pointer[]> {
  let ix: Index | undefined;
  try { ix = openIndex(); return toPointers(ix.bm25(query, k)); }
  catch { return []; }
  finally { ix?.close(); }
}

export async function hybridRecall(
  query: string,
  k: number,
  opts?: { projectSlug?: string; excludeSlugs?: string[] },
): Promise<Pointer[]> {
  let ix: Index | undefined;
  try {
    ix = openIndex();
    const bm = ix.bm25(query, k * 2);
    let vec: Hit[] = [];
    try {
      const [qv] = await embed([query]);
      vec = ix.vectorKNN(qv, k * 2);
    } catch { /* degrade to bm25-only */ }
    // INTENTIONAL precision gate (Phase 2): if BM25 has zero lexical hits we return
    // nothing rather than vector-only neighbours. vectorKNN has no distance threshold
    // yet, so an ungated path would inject k irrelevant pointers into EVERY auto-
    // injected prompt (constant noise). Tradeoff: pure-semantic-only recall (zero
    // lexical overlap + high embedding similarity) is disabled until P2.1 adds a
    // calibrated vector-distance threshold. See docs/superpowers/specs/2026-05-19-superbrain-phase2-design.md §"Known limitation".
    if (bm.length === 0) return [];
    if (vec.length === 0) {
      const exclude = new Set(opts?.excludeSlugs ?? []);
      const hits = bm.filter((h) => !exclude.has(h.relPath)).slice(0, k);
      const relPaths = [...new Set(hits.map((h) => h.relPath))];
      const projects = opts?.projectSlug ? ix.getProjectsForPaths(relPaths) : new Map<string, string>();
      const created = ix.getCreatedForPaths(relPaths);
      const now = Date.now();
      const scored = hits
        .map((h) => {
          let score = boostScore(1, projects.get(h.relPath), opts?.projectSlug);
          score *= decayFactor(created.get(h.relPath), now);
          return { h, score };
        })
        .sort((a, b) => b.score - a.score);
      return toPointers(scored.map((e) => e.h));
    }
    const byKey = new Map<string, Hit>();
    [...bm, ...vec].forEach((h) => byKey.set(keyOf(h), h));
    const fused = rrfWithScores([bm.map(keyOf), vec.map(keyOf)], k * 2);

    // Batch-lookup project and created for all candidate relPaths
    const candidateRelPaths = [...new Set(
      fused.map((e) => byKey.get(e.id)).filter(Boolean).map((h) => h!.relPath),
    )];
    const projects = opts?.projectSlug
      ? ix.getProjectsForPaths(candidateRelPaths)
      : new Map<string, string>();
    const created = ix.getCreatedForPaths(candidateRelPaths);
    const now = Date.now();
    const exclude = new Set(opts?.excludeSlugs ?? []);
    const decayed = fused
      .map((e) => {
        const hit = byKey.get(e.id);
        if (!hit) return null;
        if (exclude.has(hit.relPath)) return null;
        let score = boostScore(e.score, projects.get(hit.relPath), opts?.projectSlug);
        score *= decayFactor(created.get(hit.relPath), now);
        return { id: e.id, score };
      })
      .filter((e): e is { id: string; score: number } => e !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return toPointers(decayed.map((e) => byKey.get(e.id)!).filter(Boolean));
  } catch { return []; }
  finally { ix?.close(); }
}

function boostScore(score: number, noteProject: string | undefined, projectSlug: string | undefined): number {
  if (!projectSlug) return score;
  if (noteProject === projectSlug || noteProject === "global") return score * 2;
  return score;
}

function decayFactor(created: string | undefined, nowMs: number): number {
  if (!created) return 1;
  const createdMs = Date.parse(created);
  if (isNaN(createdMs)) return 1;
  const ageDays = (nowMs - createdMs) / 86_400_000;
  return Math.exp(-ageDays / 90);
}
