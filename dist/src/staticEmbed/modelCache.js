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
        const out = fs.createWriteStream(tmp);
        const follow = (u) => {
            https.get(u, { headers: { "User-Agent": "superbrain/1 (node)" } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    out.destroy();
                    follow(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    out.destroy();
                    reject(new Error(`HTTP ${res.statusCode} fetching ${u}`));
                    return;
                }
                res.pipe(out);
                out.on("finish", () => {
                    out.close();
                    fs.renameSync(tmp, dest);
                    resolve();
                });
                out.on("error", (e) => { fs.rmSync(tmp, { force: true }); reject(e); });
            }).on("error", (e) => { fs.rmSync(tmp, { force: true }); reject(e); });
        };
        follow(url);
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
