export function deriveEdges(notePath, fm) {
    const edges = [];
    // 1. project edge
    if (fm.project && fm.project !== "global" && fm.type !== "project") {
        edges.push({ from: notePath, to: `projects/${fm.project}.md`, kind: "project" });
    }
    // 2. daily edge
    if (fm.type !== "daily") {
        const date = fm.created ?? fm.date;
        if (date) {
            edges.push({ from: notePath, to: `daily/${date}.md`, kind: "daily" });
        }
    }
    // 3. related edges
    if (Array.isArray(fm.related)) {
        for (const entry of fm.related) {
            if (typeof entry === "string") {
                edges.push({ from: notePath, to: entry, kind: "related" });
            }
        }
    }
    // 4. supersedes edge
    if (typeof fm.superseded_by === "string") {
        edges.push({ from: notePath, to: fm.superseded_by, kind: "supersedes" });
    }
    return edges;
}
export function ensureEdgesTable(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS vault_edges (
      from_path TEXT NOT NULL,
      to_path   TEXT NOT NULL,
      kind      TEXT NOT NULL,
      PRIMARY KEY (from_path, to_path, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_vault_edges_to ON vault_edges(to_path);
    CREATE INDEX IF NOT EXISTS idx_vault_edges_from ON vault_edges(from_path);
  `);
}
export function deleteEdgesFrom(db, fromPath) {
    db.prepare("DELETE FROM vault_edges WHERE from_path = ?").run(fromPath);
}
export function upsertEdges(db, edges) {
    const ins = db.prepare("INSERT OR REPLACE INTO vault_edges (from_path, to_path, kind) VALUES (?, ?, ?)");
    const run = db.transaction((batch) => {
        for (const e of batch) {
            ins.run(e.from, e.to, e.kind);
        }
    });
    run(edges);
}
