import { openIndex, rrf, type Hit, type Index } from "./searchIndex.js";
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

export async function hybridRecall(query: string, k: number): Promise<Pointer[]> {
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
    if (vec.length === 0) return toPointers(bm.slice(0, k));
    const byKey = new Map<string, Hit>();
    [...bm, ...vec].forEach((h) => byKey.set(keyOf(h), h));
    const fused = rrf([bm.map(keyOf), vec.map(keyOf)], k);
    return toPointers(fused.map((kk) => byKey.get(kk)!).filter(Boolean));
  } catch { return []; }
  finally { ix?.close(); }
}
