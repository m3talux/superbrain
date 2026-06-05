import fs from "node:fs";
import path from "node:path";
export const MAX_REJECT_BLOCKS = 200;
export const REJECT_PRUNE_THRESHOLD = 250;
function pruneRejectFile(file) {
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    }
    catch {
        return;
    }
    const headingCount = (text.match(/^## /gm) || []).length;
    if (headingCount <= REJECT_PRUNE_THRESHOLD)
        return;
    // Split into: leading content (before first ##) + blocks
    const firstBlock = text.indexOf("\n## ");
    const leading = firstBlock === -1 ? "" : text.slice(0, firstBlock);
    // Split on "\n## " to get all blocks; re-attach the delimiter
    const rawBlocks = text.split(/(?=\n## )/);
    // The first element may be leading content (no heading), skip it
    const blocks = rawBlocks.filter((b) => b.trimStart().startsWith("## "));
    const kept = blocks.slice(-MAX_REJECT_BLOCKS);
    const newText = leading + kept.join("");
    const tmpFile = path.join(path.dirname(file), ".distill-rejects.tmp");
    fs.writeFileSync(tmpFile, newText);
    fs.renameSync(tmpFile, file);
}
export function recordRejection(vaultDir, r) {
    const file = path.join(vaultDir, "meta", "distill-rejects.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const stamp = new Date().toISOString();
    const excerpt = r.excerpt.slice(0, 200);
    const block = `\n## ${stamp} — proposed ${r.type} rejected\n**Reason:** ${r.reason}\n**Session:** ${r.sessionId}\n**Proposed title:** ${r.title}\n**Body excerpt:** ${excerpt}\n`;
    fs.appendFileSync(file, block);
    pruneRejectFile(file);
}
