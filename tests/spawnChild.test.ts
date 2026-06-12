import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnDetachedChild, spawnDetachedCommand } from "../src/spawnChild";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-spawn-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("waitFor timed out");
}

describe("spawnDetachedChild", () => {
  it("runs a detached node script to completion and returns the child", async () => {
    const marker = path.join(TMP, "marker");
    const script = path.join(TMP, "writer.js");
    fs.writeFileSync(script, `require("fs").writeFileSync(${JSON.stringify(marker)}, "ok");`);

    const child = spawnDetachedChild("test", script, process.env);
    expect(child).not.toBeNull();
    expect(typeof child!.pid).toBe("number");

    await waitFor(() => fs.existsSync(marker));
    expect(fs.readFileSync(marker, "utf8")).toBe("ok");
  });

  it("routes a spawn failure to the sentinel and invokes onError", async () => {
    const { readAndClearFailure } = await import("../src/sentinel.js");
    readAndClearFailure(); // clear any residue

    let onErrorCalled = false;
    // A non-existent cwd makes the spawn fail (sync throw or async 'error');
    // either path must reach the sentinel and the onError hook.
    spawnDetachedChild("badcwd", path.join(TMP, "noscript.js"), process.env, {
      cwd: path.join(TMP, "does-not-exist"),
      onError: () => { onErrorCalled = true; },
    });

    await waitFor(() => onErrorCalled);
    const msg = readAndClearFailure();
    expect(msg).toMatch(/badcwd spawn failed/);
  });

  it("spawnDetachedCommand runs an arbitrary command (not just node)", async () => {
    const marker = path.join(TMP, "cmd-marker");
    const script = path.join(TMP, "cmd.js");
    fs.writeFileSync(script, `require("fs").writeFileSync(${JSON.stringify(marker)}, "cmd");`);
    const child = spawnDetachedCommand("cmdtest", process.execPath, [script], process.env);
    expect(child).not.toBeNull();
    await waitFor(() => fs.existsSync(marker));
    expect(fs.readFileSync(marker, "utf8")).toBe("cmd");
  });

  it("passes the supplied env through to the child", async () => {
    const marker = path.join(TMP, "env-marker");
    const script = path.join(TMP, "envwriter.js");
    fs.writeFileSync(
      script,
      `require("fs").writeFileSync(${JSON.stringify(marker)}, process.env.SB_TEST_FLAG || "");`,
    );

    const child = spawnDetachedChild("envtest", script, { ...process.env, SB_TEST_FLAG: "xyz" });
    expect(child).not.toBeNull();
    await waitFor(() => fs.existsSync(marker));
    expect(fs.readFileSync(marker, "utf8")).toBe("xyz");
  });
});
