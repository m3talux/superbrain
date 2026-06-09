import crypto from "node:crypto";
import { getModel, embedWithModel } from "./staticEmbed/staticEmbed.js";
import { modelDir } from "./staticEmbed/modelCache.js";
export const EMBED_DIM = 256;
export const MODEL_ID = "minishlab/potion-base-8M";
function stubVector(text) {
    // Deterministic, input-sensitive pseudo-embedding for offline tests only.
    const v = new Float32Array(EMBED_DIM);
    const seed = crypto.createHash("sha256").update(text).digest();
    for (let i = 0; i < EMBED_DIM; i++)
        v[i] = (seed[i % seed.length] / 255) * 2 - 1;
    let n = Math.hypot(...v) || 1;
    for (let i = 0; i < EMBED_DIM; i++)
        v[i] /= n;
    return v;
}
export async function embed(texts) {
    if (process.env.SUPERBRAIN_EMBED_FORCE_FAIL === "1")
        throw new Error("embed forced failure (test)");
    if (process.env.SUPERBRAIN_EMBED_STUB === "1")
        return texts.map(stubVector);
    const model = await getModel();
    // Fail fast with an attributed error when the on-disk model's dimension
    // doesn't match what the index schema expects (corrupt/wrong model assets,
    // or a future model swap without a dim migration). Without this guard the
    // wrong-width vectors only fail much later, deep inside sqlite-vec, with a
    // cryptic "Dimension mismatch for inserted vector" that points nowhere.
    if (model.dim !== EMBED_DIM) {
        throw new Error(`embedding model dimension mismatch: model at ${modelDir()} produces ${model.dim}-dim vectors ` +
            `but the index expects EMBED_DIM=${EMBED_DIM} — wrong or corrupt model assets; ` +
            `delete that directory to re-download the model`);
    }
    return embedWithModel(texts, model);
}
