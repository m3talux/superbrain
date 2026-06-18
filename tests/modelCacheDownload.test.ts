/**
 * Model-download seam tests (C1 hardening): downloadFile/ensureModelAssets
 * against a local node http.Server. The 0.8.1 first-run hardening (redirects,
 * size verification, .part hygiene, idle timeout) previously had no coverage
 * at all — a regression here silently pins recall to keyword-only.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { downloadFile, ensureModelAssets } from "../src/staticEmbed/modelCache.js";

let TMP: string;
let server: http.Server | null = null;

function startServer(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-mdl-dl-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP; // lockfile home for ensureModelAssets
});

afterEach(async () => {
  if (server) {
    (server as any).closeAllConnections?.();
    await new Promise((r) => server!.close(() => r(null)));
    server = null;
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_MODEL_BASE_URL;
  delete process.env.SUPERBRAIN_MODEL_DIR;
});

describe("downloadFile", () => {
  it("follows a 302 with a RELATIVE Location (HuggingFace behavior)", async () => {
    const body = Buffer.alloc(1000, "a");
    const base = await startServer((req, res) => {
      if (req.url === "/redir/file.bin") {
        res.writeHead(302, { Location: "/real/file.bin" }); // relative, no host
        res.end();
        return;
      }
      if (req.url === "/real/file.bin") {
        res.writeHead(200, { "Content-Length": String(body.length) });
        res.end(body);
        return;
      }
      res.writeHead(404); res.end();
    });
    const dest = path.join(TMP, "file.bin");
    await downloadFile(`${base}/redir/file.bin`, dest, 100);
    expect(fs.statSync(dest).size).toBe(1000);
    expect(fs.existsSync(dest + ".part")).toBe(false);
  });

  it("rejects a complete-but-too-small body (minSize check) and cleans up .part", async () => {
    const body = Buffer.alloc(100, "b");
    const base = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Length": String(body.length) });
      res.end(body);
    });
    const dest = path.join(TMP, "small.bin");
    await expect(downloadFile(`${base}/small.bin`, dest, 1000)).rejects.toThrow(/incomplete download/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(dest + ".part")).toBe(false);
  });

  it("rejects a truncated body (content-length mismatch) and cleans up .part", async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Length": "2000" });
      res.write(Buffer.alloc(1000, "c"));
      setTimeout(() => res.destroy(), 10); // cut the connection mid-body
    });
    const dest = path.join(TMP, "trunc.bin");
    await expect(downloadFile(`${base}/trunc.bin`, dest, 100)).rejects.toThrow();
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(dest + ".part")).toBe(false);
  });

  it("rejects a non-200 response with the status code and cleans up .part", async () => {
    const base = await startServer((_req, res) => { res.writeHead(404); res.end("nope"); });
    const dest = path.join(TMP, "missing.bin");
    await expect(downloadFile(`${base}/missing.bin`, dest, 100)).rejects.toThrow(/HTTP 404/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(dest + ".part")).toBe(false);
  });

  it("rejects on idle timeout (server accepts, never responds) and cleans up .part", async () => {
    const base = await startServer(() => { /* hang forever */ });
    const dest = path.join(TMP, "hang.bin");
    await expect(downloadFile(`${base}/hang.bin`, dest, 100, 250)).rejects.toThrow(/timeout/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(dest + ".part")).toBe(false);
  });
});

describe("ensureModelAssets (injectable base URL)", () => {
  it("honors SUPERBRAIN_MODEL_BASE_URL, propagates download errors, and releases the lock", async () => {
    const base = await startServer((_req, res) => { res.writeHead(404); res.end(); });
    const modelDir = path.join(TMP, "model");
    process.env.SUPERBRAIN_MODEL_DIR = modelDir;
    process.env.SUPERBRAIN_MODEL_BASE_URL = base;

    await expect(ensureModelAssets()).rejects.toThrow(/HTTP 404/);
    // Lock must be released on failure: a second attempt hits the SAME
    // download error, not "model download already in progress".
    await expect(ensureModelAssets()).rejects.toThrow(/HTTP 404/);
    // Nothing half-written left behind.
    expect(fs.readdirSync(modelDir).filter((f) => f.endsWith(".part"))).toEqual([]);
  });
});
