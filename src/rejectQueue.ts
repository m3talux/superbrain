import fs from "node:fs";
import path from "node:path";

export interface Rejection {
  type: string;
  reason: string;
  sessionId: string;
  title: string;
  excerpt: string;
}

export function recordRejection(vaultDir: string, r: Rejection): void {
  const file = path.join(vaultDir, "meta", "distill-rejects.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stamp = new Date().toISOString();
  const excerpt = r.excerpt.slice(0, 200);
  const block = `\n## ${stamp} — proposed ${r.type} rejected\n**Reason:** ${r.reason}\n**Session:** ${r.sessionId}\n**Proposed title:** ${r.title}\n**Body excerpt:** ${excerpt}\n`;
  fs.appendFileSync(file, block);
}
