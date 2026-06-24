import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readDatasetSql } from "../src/server/source.js";

let root: string;
const SQL = "SELECT class, SUM(value_eur) AS value_eur FROM holdings GROUP BY class;\n";

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "oi-source-")));
  mkdirSync(join(root, "models", "transforms"), { recursive: true });
  writeFileSync(join(root, "models", "transforms", "allocation.sql"), SQL);
  const manifest = {
    version: 1,
    title: "Test",
    datasets: {
      allocation: { sql: "models/transforms/allocation.sql", description: "derived" },
      holdings: { source: "data/holdings.csv" },
      gone: { sql: "models/transforms/missing.sql" },
      escape: { sql: "../../../../etc/passwd" },
    },
    pages: [],
  };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("readDatasetSql", () => {
  it("returns the SQL for a transform dataset, resolved by name", async () => {
    const result = await readDatasetSql(root, "allocation");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sql: SQL });
  });

  it("rejects a missing dataset name", async () => {
    expect((await readDatasetSql(root, "")).status).toBe(400);
  });

  it("404s an unknown dataset", async () => {
    expect((await readDatasetSql(root, "nope")).status).toBe(404);
  });

  it("404s a file-backed dataset that is not a transform", async () => {
    const result = await readDatasetSql(root, "holdings");
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "'holdings' is not a transform" });
  });

  it("404s when the declared transform file is absent", async () => {
    expect((await readDatasetSql(root, "gone")).status).toBe(404);
  });

  it("refuses a transform path that escapes the project root", async () => {
    expect((await readDatasetSql(root, "escape")).status).toBe(403);
  });
});
