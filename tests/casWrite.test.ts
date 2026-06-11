import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { casWrite } from "../src/atomicWrite";

let DIR: string;
let FILE: string;

beforeEach(() => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cas-"));
  FILE = path.join(DIR, "demo.md");
});
afterEach(() => { fs.rmSync(DIR, { recursive: true, force: true }); });

describe("casWrite", () => {
  it("does not drop a concurrent peer write landing between read and rename", () => {
    fs.writeFileSync(FILE, "SEED\n");
    let firstCall = true;
    const result = casWrite(FILE, (current) => {
      if (firstCall) {
        firstCall = false;
        fs.writeFileSync(FILE, (current ?? "") + "PEER-B\n");
      }
      return (current ?? "") + "WRITER-A\n";
    });
    expect(result.ok).toBe(true);
    const final = fs.readFileSync(FILE, "utf8");
    expect(final).toContain("SEED");
    expect(final).toContain("PEER-B");
    expect(final).toContain("WRITER-A");
  });

  it("writes once when there is no contention", () => {
    const r = casWrite(FILE, (current) => (current ?? "") + "ONLY\n");
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(FILE, "utf8")).toBe("ONLY\n");
  });
});
