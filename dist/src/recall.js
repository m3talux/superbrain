import { openIndex, rrfWithScores } from "./searchIndex.js";
import { embed } from "./embed.js";
function toPointers(hits) {
    return hits.map((h) => ({
        relPath: h.relPath, headingPath: h.headingPath, anchor: h.anchor,
        excerpt: h.text.replace(/\s+/g, " ").trim().slice(0, 160),
    }));
}
const keyOf = (h) => `${h.relPath}#${h.anchor}`;
export async function bm25Recall(query, k) {
    let ix;
    try {
        ix = openIndex();
        return toPointers(ix.bm25(query, k));
    }
    catch {
        return [];
    }
    finally {
        ix?.close();
    }
}
export async function hybridRecall(query, k, opts) {
    let ix;
    try {
        ix = openIndex();
        const bm = ix.bm25(query, k * 2);
        let vec = [];
        try {
            const [qv] = await embed([query]);
            vec = ix.vectorKNN(qv, k * 2);
        }
        catch { /* degrade to bm25-only */ }
        // INTENTIONAL precision gate (Phase 2): if BM25 has zero lexical hits we return
        // nothing rather than vector-only neighbours. vectorKNN has no distance threshold
        // yet, so an ungated path would inject k irrelevant pointers into EVERY auto-
        // injected prompt (constant noise). Tradeoff: pure-semantic-only recall (zero
        // lexical overlap + high embedding similarity) is disabled until P2.1 adds a
        // calibrated vector-distance threshold. See docs/superpowers/specs/2026-05-19-superbrain-phase2-design.md §"Known limitation".
        if (bm.length === 0)
            return [];
        if (vec.length === 0) {
            const hits = bm.slice(0, k);
            const relPaths = [...new Set(hits.map((h) => h.relPath))];
            const projects = opts?.projectSlug ? ix.getProjectsForPaths(relPaths) : new Map();
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
        const byKey = new Map();
        [...bm, ...vec].forEach((h) => byKey.set(keyOf(h), h));
        const fused = rrfWithScores([bm.map(keyOf), vec.map(keyOf)], k * 2);
        // Batch-lookup project and created for all candidate relPaths
        const candidateRelPaths = [...new Set(fused.map((e) => byKey.get(e.id)).filter(Boolean).map((h) => h.relPath))];
        const projects = opts?.projectSlug
            ? ix.getProjectsForPaths(candidateRelPaths)
            : new Map();
        const created = ix.getCreatedForPaths(candidateRelPaths);
        const now = Date.now();
        const decayed = fused
            .map((e) => {
            const hit = byKey.get(e.id);
            if (!hit)
                return null;
            let score = boostScore(e.score, projects.get(hit.relPath), opts?.projectSlug);
            score *= decayFactor(created.get(hit.relPath), now);
            return { id: e.id, score };
        })
            .filter((e) => e !== null)
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
        return toPointers(decayed.map((e) => byKey.get(e.id)).filter(Boolean));
    }
    catch {
        return [];
    }
    finally {
        ix?.close();
    }
}
function boostScore(score, noteProject, projectSlug) {
    if (!projectSlug)
        return score;
    if (noteProject === projectSlug || noteProject === "global")
        return score * 2;
    return score;
}
function decayFactor(created, nowMs) {
    if (!created)
        return 1;
    const createdMs = Date.parse(created);
    if (isNaN(createdMs))
        return 1;
    const ageDays = (nowMs - createdMs) / 86_400_000;
    return Math.exp(-ageDays / 90);
}
