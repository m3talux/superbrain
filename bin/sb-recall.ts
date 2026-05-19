#!/usr/bin/env node
import fs from "node:fs";
import { isChild } from "../src/distillerEngine.js";
import { bm25Recall } from "../src/recall.js";

function readStdin(): string { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }

async function main() {
  if (isChild()) process.exit(0);
  try {
    let h: any; try { h = JSON.parse(readStdin()); } catch { process.exit(0); }
    const prompt = (h?.prompt || "").trim();
    if (!prompt) process.exit(0);
    const hits = await bm25Recall(prompt, 5);
    if (hits.length) {
      const lines = hits.map((p) => `- [[${p.relPath.replace(/\.md$/, "")}]]${p.headingPath ? " › " + p.headingPath : ""} — ${p.excerpt}`);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "SuperBrain recall (your vault may already answer this):\n" + lines.join("\n"),
        },
      }));
    }
  } catch { /* never disrupt the turn */ }
  process.exit(0);
}
main();
