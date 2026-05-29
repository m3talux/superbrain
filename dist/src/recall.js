import { openIndex, rrfWithScores } from "./searchIndex.js";
import { embed } from "./embed.js";
const VECTOR_DISTANCE_CUTOFF = 1.0;
function toPointers(hits) {
    return hits.map((h) => ({
        relPath: h.relPath, headingPath: h.headingPath, anchor: h.anchor,
        excerpt: h.text.replace(/\s+/g, " ").trim().slice(0, 160),
    }));
}
const keyOf = (h) => `${h.relPath}#${h.anchor}`;
function isCrossProject(noteProject, projectSlug) {
    return noteProject != null && noteProject !== "global" && noteProject !== projectSlug;
}
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
        // bm25Only skips the embedding model entirely. Short-lived hooks (SessionStart,
        // UserPromptSubmit) must exit cleanly; loading onnxruntime there aborts the
        // process on teardown under some Node runtimes, so they pass bm25Only.
        if (!opts?.bm25Only) {
            try {
                const [qv] = await embed([query]);
                const raw = ix.vectorKNN(qv, k * 2);
                vec = raw.filter((h) => h.distance == null || h.distance <= VECTOR_DISTANCE_CUTOFF);
            }
            catch { /* degrade to bm25-only */ }
        }
        // INTENTIONAL precision gate: if BM25 has zero lexical hits we return nothing
        // rather than vector-only neighbours, preventing constant noise injection.
        if (bm.length === 0)
            return [];
        if (vec.length === 0) {
            const exclude = new Set(opts?.excludeSlugs ?? []);
            const relPaths = [...new Set(bm.map((h) => h.relPath))];
            const projects = opts?.projectSlug ? ix.getProjectsForPaths(relPaths) : new Map();
            const created = ix.getCreatedForPaths(relPaths);
            const now = Date.now();
            const scored = bm
                .filter((h) => !exclude.has(h.relPath))
                .filter((h) => !opts?.projectSlug || !isCrossProject(projects.get(h.relPath), opts.projectSlug))
                .map((h) => {
                let score = boostScore(1, projects.get(h.relPath), opts?.projectSlug);
                score *= decayFactor(created.get(h.relPath), now);
                return { h, score };
            })
                .sort((a, b) => b.score - a.score)
                .slice(0, k);
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
        const exclude = new Set(opts?.excludeSlugs ?? []);
        const decayed = fused
            .map((e) => {
            const hit = byKey.get(e.id);
            if (!hit)
                return null;
            if (exclude.has(hit.relPath))
                return null;
            if (opts?.projectSlug && isCrossProject(projects.get(hit.relPath), opts.projectSlug))
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
