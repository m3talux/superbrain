#!/usr/bin/env node
import fs from "node:fs";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";
import { writeFailure } from "../src/sentinel.js";

interface ParsedArgs {
  text: string;
  opts: { verbatim?: boolean; distill?: boolean; project?: string };
  errors: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const opts: ParsedArgs["opts"] = {};
  const errors: string[] = [];
  const positional: string[] = [];
  let fromFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--verbatim") opts.verbatim = true;
    else if (a === "--distill") opts.distill = true;
    else if (a === "--project") {
      const next = argv[++i];
      if (!next) errors.push("--project requires a slug");
      else opts.project = next;
    } else if (a === "--from-file") {
      const next = argv[++i];
      if (!next) errors.push("--from-file requires a path");
      else fromFile = next;
    } else if (a.startsWith("--")) {
      errors.push(`unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  let text = "";
  if (fromFile) {
    try {
      const st = fs.statSync(fromFile);
      if (st.isDirectory()) errors.push(`--from-file is a directory: ${fromFile}`);
      else text = fs.readFileSync(fromFile, "utf8");
    } catch { errors.push(`--from-file not found: ${fromFile}`); }
  } else if (positional.length > 0) {
    text = positional.join(" ");
  } else {
    try {
      if (!process.stdin.isTTY) text = fs.readFileSync(0, "utf8");
    } catch { /* no stdin */ }
  }
  return { text, opts, errors };
}

async function main() {
  if (!depsPresent(pluginRoot())) {
    process.stderr.write("inject: dependencies not yet installed (bootstrap pending)\n");
    process.exit(3);
  }
  const { text, opts, errors } = parseArgs(process.argv.slice(2));
  if (errors.length > 0) {
    process.stderr.write(errors.join("\n") + "\n");
    process.exit(2);
  }
  if (text.length === 0) {
    process.stderr.write("inject: no text provided. Pass text as argument, --from-file <path>, or pipe via stdin.\n");
    process.exit(2);
  }
  try {
    const mod = await import("../src/injectRun.js");
    const result = await mod.runInject(text, { ...opts, cwd: process.cwd() });
    if (!result.ok) {
      process.stderr.write(`inject: ${result.message || "failed"}\n`);
      process.exit(2);
    }
    const noteCount = result.notes.length;
    const fallbackNote = result.fallback ? " (LLM returned no items — wrote verbatim)" : "";
    process.stdout.write(`Wrote ${noteCount} note${noteCount === 1 ? "" : "s"} in ${result.mode} mode${fallbackNote}:\n`);
    for (const rel of result.notes) process.stdout.write(`  - ${rel}\n`);
    process.exit(0);
  } catch (e: any) {
    try { writeFailure(`inject crashed: ${e?.message || e}`); } catch { /* noop */ }
    process.stderr.write(`inject: ${e?.message || e}\n`);
    process.exit(3);
  }
}

if ((process.argv[1] && process.argv[1].endsWith("sb-inject.ts")) || process.argv[1]?.endsWith("sb-inject.js")) main();
