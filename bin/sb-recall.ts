#!/usr/bin/env node
import fs from "node:fs";
import { isChild } from "../src/distillerEngine.js";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";
import { getInjectedSlugs, appendInjectedSlugs } from "../src/sessionInjected.js";

function readStdin(): string { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }

async function main() {
  if (isChild()) process.exit(0);
  try {
    if (!depsPresent(pluginRoot())) process.exit(0); // search not bootstrapped yet
    let h: any; try { h = JSON.parse(readStdin()); } catch { process.exit(0); }
    const prompt = (h?.prompt || "").trim();
    if (!prompt) process.exit(0);
    const sid: string = h?.session_id || "";
    const excludeSlugs = sid ? getInjectedSlugs(sid) : [];
    const { hybridRecall } = await import("../src/recall.js"); // deferred: only after deps check
    const hits = await hybridRecall(prompt, 5, { excludeSlugs });
    if (hits.length) {
      // Record newly injected paths so subsequent UserPromptSubmit calls also exclude them.
      if (sid) {
        try { appendInjectedSlugs(sid, hits.map((p: any) => p.relPath)); } catch { /* best-effort */ }
      }
      const lines = hits.map((p: any) => `- [[${p.relPath.replace(/\.md$/, "")}]]${p.headingPath ? " › " + p.headingPath : ""} — ${p.excerpt}`);
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
