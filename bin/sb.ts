#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dataDir } from "../src/paths.js";

export function migrateLegacy(home = os.homedir()): { archived: string[] } {
  const archiveDir = path.join(dataDir(), "archived-legacy");
  const targets = [
    path.join(home, ".claude", "hooks", "stop-scribe.sh"),
    path.join(home, ".claude", "skills", "scribe"),
  ];
  const archived: string[] = [];
  for (const t of targets) {
    if (fs.existsSync(t)) {
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.renameSync(t, path.join(archiveDir, path.basename(t)));
      archived.push(path.basename(t));
    }
  }
  return { archived };
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "migrate") { console.log(JSON.stringify(migrateLegacy())); return; }
  if (cmd === "install") {
    fs.mkdirSync(dataDir(), { recursive: true });
    console.log("SuperBrain installed. Data dir: " + dataDir());
    return;
  }
  console.log("usage: superbrain <install|migrate>");
}
if ((process.argv[1] && process.argv[1].endsWith("sb.ts")) || process.argv[1]?.endsWith("sb.js")) main();
