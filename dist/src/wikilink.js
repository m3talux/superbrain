import fs from "node:fs";
import path from "node:path";
const VAULT_FOLDERS = ["projects", "decisions", "lessons", "capture", "people", "daily", "meta", "maps"];
const FOLDER_PREFERENCE = new Map(VAULT_FOLDERS.map((f, i) => [f, i]));
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
function tokenize(s) {
    return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function buildIndex(vaultRoot) {
    const ix = { byRelPath: new Set(), byBasename: new Map(), byTokens: [] };
    for (const folder of VAULT_FOLDERS) {
        const dir = path.join(vaultRoot, folder);
        let entries;
        try {
            entries = fs.readdirSync(dir);
        }
        catch {
            continue;
        }
        for (const f of entries) {
            if (!f.endsWith(".md"))
                continue;
            const stem = f.slice(0, -3);
            const rel = `${folder}/${stem}`;
            ix.byRelPath.add(rel);
            const stripped = stem.replace(DATE_PREFIX, "");
            const arr = ix.byBasename.get(stem) ?? [];
            arr.push(rel);
            ix.byBasename.set(stem, arr);
            if (stripped !== stem) {
                const arr2 = ix.byBasename.get(stripped) ?? [];
                arr2.push(rel);
                ix.byBasename.set(stripped, arr2);
            }
            ix.byTokens.push({ rel, tokens: new Set(tokenize(stripped)) });
        }
    }
    return ix;
}
function normalize(raw) {
    return raw.replace(/^\[\[/, "").replace(/\]\]$/, "").replace(/\.md$/i, "").trim();
}
function pickPreferred(rels) {
    return [...rels].sort((a, b) => {
        const af = a.split("/")[0];
        const bf = b.split("/")[0];
        const ai = FOLDER_PREFERENCE.get(af) ?? 99;
        const bi = FOLDER_PREFERENCE.get(bf) ?? 99;
        return ai - bi;
    })[0];
}
export function resolveLinks(links, vaultRoot) {
    if (!links || links.length === 0)
        return [];
    const ix = buildIndex(vaultRoot);
    if (ix.byRelPath.size === 0)
        return [];
    const out = [];
    const seen = new Set();
    for (const raw of links) {
        const link = normalize(raw);
        if (!link)
            continue;
        const resolved = resolveOne(link, ix);
        if (resolved && !seen.has(resolved)) {
            out.push(resolved);
            seen.add(resolved);
        }
    }
    return out;
}
function resolveOne(link, ix) {
    if (link.includes("/")) {
        return ix.byRelPath.has(link) ? link : null;
    }
    const exact = ix.byBasename.get(link);
    if (exact && exact.length > 0)
        return pickPreferred(exact);
    const linkTokens = tokenize(link);
    if (linkTokens.length < 2)
        return null;
    const linkSet = new Set(linkTokens);
    const matches = [];
    for (const entry of ix.byTokens) {
        let allIn = true;
        for (const t of linkSet) {
            if (!entry.tokens.has(t)) {
                allIn = false;
                break;
            }
        }
        if (allIn)
            matches.push(entry.rel);
    }
    if (matches.length === 0)
        return null;
    return pickPreferred(matches);
}
