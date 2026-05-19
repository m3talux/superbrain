import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

describe("native deps", () => {
  it("better-sqlite3 has FTS5 and sqlite-vec loads vec0", () => {
    const db = new Database(":memory:");
    sqliteVec.load(db);
    db.exec("CREATE VIRTUAL TABLE f USING fts5(t)");
    db.prepare("INSERT INTO f(t) VALUES (?)").run("hello world");
    const hit = db.prepare("SELECT t FROM f WHERE f MATCH ?").get("hello") as any;
    expect(hit.t).toBe("hello world");
    db.exec("CREATE VIRTUAL TABLE v USING vec0(id integer primary key, e float[3])");
    db.prepare("INSERT INTO v(id,e) VALUES (1,?)").run(JSON.stringify([0.1, 0.2, 0.3]));
    const row = db.prepare(
      "SELECT id, distance FROM v WHERE e MATCH ? ORDER BY distance LIMIT 1"
    ).get(JSON.stringify([0.1, 0.2, 0.3])) as any;
    expect(row.id).toBe(1);
    db.close();
  });
});
