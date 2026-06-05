/**
 * Fetches and caches model assets for potion-base-8M on first use.
 * Model dir is overridable via SUPERBRAIN_MODEL_DIR (used in tests).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
const HF_BASE = "https://huggingface.co/minishlab/potion-base-8M/resolve/main";
const ASSETS = ["model.safetensors", "tokenizer.json"];
export function modelDir() {
    if (process.env.SUPERBRAIN_MODEL_DIR)
        return process.env.SUPERBRAIN_MODEL_DIR;
    return path.join(os.homedir(), ".superbrain", "models", "potion-base-8M");
}
export function modelAssetPath(asset) {
    return path.join(modelDir(), asset);
}
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const tmp = dest + ".part";
        const cleanup = () => { try {
            fs.rmSync(tmp, { force: true });
        }
        catch { /* ignore */ } };
        const follow = (u, depth) => {
            if (depth > 5) {
                reject(new Error(`too many redirects fetching ${url}`));
                return;
            }
            const req = https.get(u, { headers: { "User-Agent": "superbrain/1 (node)" } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    res.resume();
                    follow(res.headers.location, depth + 1);
                    return;
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode} fetching ${u}`));
                    return;
                }
                const out = fs.createWriteStream(tmp);
                res.on("error", (e) => { out.destroy(); cleanup(); reject(e); });
                out.on("error", (e) => { cleanup(); reject(e); });
                out.on("finish", () => { out.close(); fs.renameSync(tmp, dest); resolve(); });
                res.pipe(out);
            });
            req.setTimeout(60000, () => { req.destroy(new Error(`timeout fetching ${u}`)); });
            req.on("error", (e) => { cleanup(); reject(e); });
        };
        follow(url, 0);
    });
}
export async function ensureModelAssets() {
    const dir = modelDir();
    fs.mkdirSync(dir, { recursive: true });
    for (const asset of ASSETS) {
        const dest = path.join(dir, asset);
        if (!fs.existsSync(dest)) {
            process.stderr.write(`[superbrain] downloading ${asset} from HuggingFace...\n`);
            await downloadFile(`${HF_BASE}/${asset}`, dest);
            process.stderr.write(`[superbrain] cached ${asset}\n`);
        }
    }
}
