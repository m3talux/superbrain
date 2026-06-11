import fs from "node:fs";

const TAIL_BYTES = 256 * 1024;

export function readLastAssistantText(transcriptPath: string | undefined): string {
  if (!transcriptPath) return "";
  let fd: number;
  try { fd = fs.openSync(transcriptPath, "r"); } catch { return ""; }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let lines = buf.toString("utf8").split("\n");
    if (start > 0) lines = lines.slice(1);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let j: any;
      try { j = JSON.parse(line); } catch { continue; }
      if (j?.type !== "assistant") continue;
      const content = j?.message?.content;
      if (typeof content === "string" && content.trim()) return content.trim();
      if (Array.isArray(content)) {
        const t = content
          .filter((c: any) => c?.type === "text" && typeof c.text === "string")
          .map((c: any) => c.text)
          .join(" ")
          .trim();
        if (t) return t;
      }
    }
    return "";
  } catch {
    return "";
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}
