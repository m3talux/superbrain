import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

function mkenv(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sb-injectE2E-${name}-`));
  const dataDir = path.join(root, "data");
  const vaultDir = path.join(root, "vault");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  return { dataDir, vaultDir };
}

function run(args: string[], env: Record<string, string>) {
  return execFileSync("npx", ["tsx", "bin/sb-inject.ts", ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

describe("inject E2E", () => {
  const today = new Date().toISOString().slice(0, 10);

  it("scenario 1 — short input → verbatim capture, daily note, index", () => {
    const { dataDir, vaultDir } = mkenv("s1");
    const env = {
      SUPERBRAIN_DATA_DIR: dataDir,
      SUPERBRAIN_VAULT_DIR: vaultDir,
      SUPERBRAIN_EMBED_STUB: "1",
    };

    const out = run(["a short freeform thought about provisioning"], env);
    expect(out).toMatch(/Wrote 1 note in verbatim mode/);

    const captureFiles = fs.readdirSync(path.join(vaultDir, "capture"));
    expect(captureFiles).toHaveLength(1);
    const captureBody = fs.readFileSync(path.join(vaultDir, "capture", captureFiles[0]), "utf8");
    expect(captureBody).toMatch(/source: inject/);
    expect(captureBody).toMatch(/inject_mode: verbatim/);
    expect(captureBody).toMatch(/<!-- superbrain:inject /);
    expect(captureBody).toMatch(/a short freeform thought about provisioning/);

    const dailyPath = path.join(vaultDir, "daily", `${today}.md`);
    expect(fs.existsSync(dailyPath)).toBe(true);
    expect(fs.readFileSync(dailyPath, "utf8")).toContain(captureFiles[0].replace(/\.md$/, ""));

    expect(fs.existsSync(path.join(dataDir, "index.db"))).toBe(true);
  });

  it("scenario 2 — long multi-topic input + stubbed multi-item envelope → all routed", () => {
    const { dataDir, vaultDir } = mkenv("s2");
    fs.mkdirSync(path.join(vaultDir, "projects"), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, "projects/wcloud.md"), "---\ntype: project\nproject: wcloud\n---\n# wcloud\n");

    const stub = path.join(dataDir, "stub.json");
    fs.writeFileSync(stub, JSON.stringify({
      items: [
        { kind: "decision", title: "Use Sonnet for inject", date: today,
          context: "options weighed", decision: "Sonnet 4.6", rationale: "cost/quality", links: [] },
        { kind: "project_fact", title: "wcloud uses HTTP transport", date: today,
          project: "wcloud", body: "Transport choice", links: [] },
        { kind: "capture", title: "Reminder", date: today, body: "ask Pierre about TwinGate", links: [] },
      ],
    }));

    const env = {
      SUPERBRAIN_DATA_DIR: dataDir,
      SUPERBRAIN_VAULT_DIR: vaultDir,
      SUPERBRAIN_EMBED_STUB: "1",
      SUPERBRAIN_DISTILL_STUB: stub,
    };

    const longInput = "Meeting summary:\n\n" + "details ".repeat(40);
    const out = run([longInput], env);
    expect(out).toMatch(/Wrote 3 notes in distill mode/);

    expect(fs.existsSync(path.join(vaultDir, "decisions", `${today}-use-sonnet-for-inject.md`))).toBe(true);
    const wcloudBody = fs.readFileSync(path.join(vaultDir, "projects/wcloud.md"), "utf8");
    expect(wcloudBody).toMatch(/wcloud uses HTTP transport/);
    expect(fs.readdirSync(path.join(vaultDir, "capture")).length).toBe(1);

    const dailyBody = fs.readFileSync(path.join(vaultDir, "daily", `${today}.md`), "utf8");
    expect(dailyBody).toMatch(/use-sonnet-for-inject/);
  });

  it("scenario 3 — long input + empty envelope → verbatim fallback", () => {
    const { dataDir, vaultDir } = mkenv("s3");
    const stub = path.join(dataDir, "stub.json");
    fs.writeFileSync(stub, JSON.stringify({ items: [] }));

    const env = {
      SUPERBRAIN_DATA_DIR: dataDir,
      SUPERBRAIN_VAULT_DIR: vaultDir,
      SUPERBRAIN_EMBED_STUB: "1",
      SUPERBRAIN_DISTILL_STUB: stub,
    };

    const longInput = "x".repeat(400);
    const out = run([longInput], env);
    expect(out).toMatch(/wrote verbatim/);
    expect(fs.readdirSync(path.join(vaultDir, "capture")).length).toBe(1);
  });
});
