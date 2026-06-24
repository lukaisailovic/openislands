import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Column } from "../src/index.js";
import {
  buildQuerySql,
  checkQueries,
  ftsTableName,
  queryColumns,
  queryParamSchema,
  readManifest,
  runQuery,
  QueryValidationError,
  resetEngine,
} from "../src/index.js";

const projects: string[] = [];
afterEach(() => {
  for (const dir of projects.splice(0)) resetEngine(dir);
});

function project(manifest: unknown, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-qry-"));
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  projects.push(dir);
  return dir;
}

function manifestWith(queries: Record<string, unknown>, source = "data/meals.csv") {
  return {
    version: 1,
    title: "T",
    datasets: { meals: { source } },
    pages: [{ id: "p", islands: [{ type: "table.grid", title: "Meals", dataset: "meals" }] }],
    queries,
  };
}

const MEALS_CSV =
  "name,kcal,logged\nOatmeal,300,2026-01-01\nEggs,200,2026-01-02\nToast,150,2026-01-03\n";

describe("queryParamSchema", () => {
  it("requires a param by default", async () => {
    const dir = project(
      manifestWith({ by_kcal: { dataset: "meals", params: { n: { type: "number" } }, where: [{ field: "kcal", op: "eq", param: "n" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const schema = await queryParamSchema(dir, "by_kcal");
    expect(schema.safeParse({ n: 200 }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("treats required:false as optional", async () => {
    const dir = project(
      manifestWith({ q: { dataset: "meals", params: { n: { type: "number", required: false } }, where: [{ field: "kcal", op: "eq", param: "n" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const schema = await queryParamSchema(dir, "q");
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("applies a default when the param is omitted", async () => {
    const dir = project(
      manifestWith({ q: { dataset: "meals", params: { name: { default: "Eggs" } }, where: [{ field: "name", op: "eq", param: "name" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const schema = await queryParamSchema(dir, "q");
    expect(schema.parse({}).name).toBe("Eggs");
  });

  it("enforces enum and numeric min/max", async () => {
    const dir = project(
      manifestWith({
        q: {
          dataset: "meals",
          params: { name: { enum: ["Eggs", "Oatmeal"] }, kcal: { type: "number", min: 0, max: 1000 } },
          where: [{ field: "name", op: "eq", param: "name" }, { field: "kcal", op: "gte", param: "kcal" }],
        },
      }),
      { "data/meals.csv": MEALS_CSV },
    );
    const schema = await queryParamSchema(dir, "q");
    expect(schema.safeParse({ name: "Sushi", kcal: 1 }).success).toBe(false);
    expect(schema.safeParse({ name: "Eggs", kcal: 5000 }).success).toBe(false);
    expect(schema.safeParse({ name: "Eggs", kcal: 200 }).success).toBe(true);
  });

  it("rejects an unknown param key (strict)", async () => {
    const dir = project(
      manifestWith({ q: { dataset: "meals", params: { n: { type: "number" } }, where: [{ field: "kcal", op: "eq", param: "n" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const schema = await queryParamSchema(dir, "q");
    expect(schema.safeParse({ n: 200, extra: 1 }).success).toBe(false);
  });

  it("throws on an unknown query name", async () => {
    const dir = project(manifestWith({ q: { dataset: "meals" } }), { "data/meals.csv": MEALS_CSV });
    await expect(queryParamSchema(dir, "nope")).rejects.toThrow(/unknown query/);
  });
});

describe("runQuery", () => {
  it("returns rows matching a bound param", async () => {
    const dir = project(
      manifestWith({ by_kcal: { dataset: "meals", select: ["name"], params: { n: { type: "number" } }, where: [{ field: "kcal", op: "eq", param: "n" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const result = await runQuery(dir, "by_kcal", { n: 200 });
    expect(result.rows).toEqual([{ name: "Eggs" }]);
  });

  it("drops an omitted optional param's filter, so ordering picks the latest", async () => {
    const dir = project(
      manifestWith({
        latest: {
          dataset: "meals",
          select: ["name"],
          params: { on: { type: "date", required: false } },
          where: [{ field: "logged", op: "eq", param: "on" }],
          orderBy: [{ field: "logged", dir: "desc" }],
          limit: 1,
        },
      }),
      { "data/meals.csv": MEALS_CSV },
    );
    const fallback = await runQuery(dir, "latest", {});
    expect(fallback.rows).toEqual([{ name: "Toast" }]);

    const explicit = await runQuery(dir, "latest", { on: "2026-01-02" });
    expect(explicit.rows).toEqual([{ name: "Eggs" }]);
  });

  it("throws QueryValidationError naming a missing required param", async () => {
    const dir = project(
      manifestWith({ by_kcal: { dataset: "meals", select: ["name"], params: { n: { type: "number" } }, where: [{ field: "kcal", op: "eq", param: "n" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const err = await runQuery(dir, "by_kcal", {}).catch((e) => e);
    expect(err).toBeInstanceOf(QueryValidationError);
    expect((err as QueryValidationError).errors.some((e) => e.param === "n")).toBe(true);
  });

  it("binds a param as a value — an injection payload returns no rows, not all rows", async () => {
    const dir = project(
      manifestWith({ by_name: { dataset: "meals", select: ["name"], params: { name: { type: "string" } }, where: [{ field: "name", op: "eq", param: "name" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const result = await runQuery(dir, "by_name", { name: "' OR 1=1 --" });
    expect(result.rows).toHaveLength(0);
  });

  it("matches case-insensitively with the contains op", async () => {
    const dir = project(
      manifestWith({ search: { dataset: "meals", select: ["name"], params: { q: { type: "string" } }, where: [{ field: "name", op: "contains", param: "q" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const result = await runQuery(dir, "search", { q: "egg" });
    expect(result.rows).toEqual([{ name: "Eggs" }]);
  });

  it("compares against a literal value", async () => {
    const dir = project(
      manifestWith({ rich: { dataset: "meals", select: ["name"], where: [{ field: "kcal", op: "gte", value: 250 }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const result = await runQuery(dir, "rich", {});
    expect(result.rows).toEqual([{ name: "Oatmeal" }]);
  });

  it("filters with the in op over a literal array", async () => {
    const dir = project(
      manifestWith({ some: { dataset: "meals", select: ["name"], where: [{ field: "name", op: "in", value: ["Eggs", "Toast"] }], orderBy: [{ field: "name", dir: "asc" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const result = await runQuery(dir, "some", {});
    expect(result.rows).toEqual([{ name: "Eggs" }, { name: "Toast" }]);
  });

  it("aggregates with a renamed select", async () => {
    const dir = project(
      manifestWith({ totals: { dataset: "meals", select: [{ field: "kcal", fn: "sum", as: "total" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const result = await runQuery(dir, "totals", {});
    expect(result.rows).toEqual([{ total: 650 }]);
  });

  it("matches a timestamp field to a day with sameDay", async () => {
    const dir = project(
      {
        version: 1,
        title: "T",
        datasets: { events: { source: "data/events.csv" } },
        pages: [{ id: "p", islands: [{ type: "table.grid", title: "E", dataset: "events" }] }],
        queries: { on_day: { dataset: "events", select: ["label"], params: { day: { type: "date" } }, where: [{ field: "ts", op: "sameDay", param: "day" }] } },
      },
      { "data/events.csv": "ts,label\n2026-01-01 08:00:00,a\n2026-01-02 09:30:00,b\n2026-01-02 18:00:00,c\n" },
    );
    const result = await runQuery(dir, "on_day", { day: "2026-01-02" });
    expect(result.rows.map((r) => r.label)).toEqual(["b", "c"]);
  });

  it("respects the row cap", async () => {
    const dir = project(
      manifestWith({ all: { dataset: "meals", select: ["name"], orderBy: [{ field: "kcal", dir: "asc" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const result = await runQuery(dir, "all", {}, { limit: 2 });
    expect(result.rows).toHaveLength(2);
  });

  it("throws naming a field that is not a dataset column", async () => {
    const dir = project(
      manifestWith({ bad: { dataset: "meals", where: [{ field: "missing", op: "eq", value: 1 }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    await expect(runQuery(dir, "bad", {})).rejects.toThrow(/missing/);
  });
});

describe("buildQuerySql", () => {
  const columns: Column[] = [
    { name: "date", type: "date" },
    { name: "kcal", type: "number" },
    { name: "name", type: "string" },
  ];

  it("casts a date column comparison and binds the param by name", () => {
    const built = buildQuerySql(
      { dataset: "macros", where: [{ field: "date", op: "eq", param: "date" }] } as never,
      columns,
      { date: "2026-01-02" },
    );
    expect(built.sql).toBe('SELECT * FROM "macros" WHERE "date" = TRY_CAST($date AS DATE)');
    expect(built.params).toEqual({ date: "2026-01-02" });
  });

  it("does not cast a numeric comparison", () => {
    const built = buildQuerySql(
      { dataset: "macros", select: ["name"], where: [{ field: "kcal", op: "gte", param: "n" }] } as never,
      columns,
      { n: 100 },
    );
    expect(built.sql).toBe('SELECT "name" FROM "macros" WHERE "kcal" >= $n');
  });

  it("drops a filter whose optional param was not supplied", () => {
    const built = buildQuerySql(
      { dataset: "macros", where: [{ field: "kcal", op: "eq", param: "n" }], orderBy: [{ field: "date", dir: "desc" }], limit: 1 } as never,
      columns,
      {},
    );
    expect(built.sql).toBe('SELECT * FROM "macros" ORDER BY "date" DESC LIMIT 1');
    expect(built.params).toEqual({});
  });

  it("binds a literal value under a generated name", () => {
    const built = buildQuerySql(
      { dataset: "macros", select: ["name"], where: [{ field: "kcal", op: "gte", value: 250 }] } as never,
      columns,
      {},
    );
    expect(built.sql).toBe('SELECT "name" FROM "macros" WHERE "kcal" >= $_v0');
    expect(built.params).toEqual({ _v0: 250 });
  });
});

describe("buildQuerySql (FTS search branch)", () => {
  const columns: Column[] = [
    { name: "name", type: "string" },
    { name: "brand", type: "string" },
    { name: "kcal", type: "number" },
  ];
  const search = { fields: ["name", "brand"], param: "q", stemmer: "porter" as const, stopwords: "english" as const };

  it("reads from the sidecar table, filters on a non-null BM25 match, and orders by relevance", () => {
    const built = buildQuerySql({ dataset: "ingredients", search } as never, columns, { q: "greek yogurt" });
    const table = ftsTableName("ingredients", search);
    const score = `fts_main_${table}.match_bm25(_rowid, $q)`;
    expect(built.sql).toBe(`SELECT * EXCLUDE (_rowid) FROM "${table}" WHERE ${score} IS NOT NULL ORDER BY ${score} DESC`);
  });

  it("binds the search param even without a where filter", () => {
    const built = buildQuerySql({ dataset: "ingredients", search } as never, columns, { q: "yogurt" });
    expect(built.params).toEqual({ q: "yogurt" });
  });

  it("projects the explicit select instead of excluding _rowid when select is given", () => {
    const built = buildQuerySql({ dataset: "ingredients", select: ["name", "brand"], search } as never, columns, { q: "yogurt" });
    const table = ftsTableName("ingredients", search);
    expect(built.sql).toContain(`SELECT "name", "brand" FROM "${table}"`);
    expect(built.sql).not.toContain("EXCLUDE");
  });

  it("projects the BM25 score under scoreField when set, and omits it when not", () => {
    const table = ftsTableName("ingredients", search);
    const score = `fts_main_${table}.match_bm25(_rowid, $q)`;
    const scored = buildQuerySql({ dataset: "ingredients", search: { ...search, scoreField: "relevance" } } as never, columns, { q: "yogurt" });
    expect(scored.sql).toContain(`${score} AS "relevance"`);
    const plain = buildQuerySql({ dataset: "ingredients", search } as never, columns, { q: "yogurt" });
    expect(plain.sql).not.toContain(" AS ");
  });

  it("lets an explicit orderBy win over relevance ranking", () => {
    const built = buildQuerySql({ dataset: "ingredients", search, orderBy: [{ field: "name", dir: "asc" }] } as never, columns, { q: "yogurt" });
    expect(built.sql).toContain('ORDER BY "name" ASC');
    expect(built.sql).not.toContain("ORDER BY fts_main");
  });

  it("ANDs a where filter on top of the match and appends a LIMIT", () => {
    const table = ftsTableName("ingredients", search);
    const score = `fts_main_${table}.match_bm25(_rowid, $q)`;
    const built = buildQuerySql(
      { dataset: "ingredients", search, where: [{ field: "kcal", op: "gte", value: 100 }], limit: 5 } as never,
      columns,
      { q: "yogurt" },
    );
    expect(built.sql).toBe(`SELECT * EXCLUDE (_rowid) FROM "${table}" WHERE ${score} IS NOT NULL AND "kcal" >= $_v0 ORDER BY ${score} DESC LIMIT 5`);
    expect(built.params).toEqual({ q: "yogurt", _v0: 100 });
  });
});

describe("queryColumns", () => {
  it("returns the dataset columns when no select is given", async () => {
    const dir = project(manifestWith({ q: { dataset: "meals" } }), { "data/meals.csv": MEALS_CSV });
    const cols = await queryColumns(dir, "q");
    expect(cols.map((c) => c.name)).toEqual(["name", "kcal", "logged"]);
  });

  it("reflects select projections and aggregate types", async () => {
    const dir = project(
      manifestWith({ q: { dataset: "meals", select: ["name", { field: "kcal", fn: "sum", as: "total" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const cols = await queryColumns(dir, "q");
    expect(cols).toEqual([
      { name: "name", type: "string" },
      { name: "total", type: "number" },
    ]);
  });
});

describe("checkQueries", () => {
  it("flags an unknown dataset", async () => {
    const dir = project(manifestWith({ q: { dataset: "nope" } }), { "data/meals.csv": MEALS_CSV });
    const errors = await checkQueries(dir, await readManifest(dir));
    expect(errors.some((e) => e.query === "q" && e.field === "dataset")).toBe(true);
  });

  it("flags a where field that is not a column, naming it", async () => {
    const dir = project(
      manifestWith({ q: { dataset: "meals", where: [{ field: "protein", op: "eq", value: 1 }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const errors = await checkQueries(dir, await readManifest(dir));
    expect(errors.some((e) => e.query === "q" && e.message.includes("protein"))).toBe(true);
  });

  it("flags a select field that is not a column", async () => {
    const dir = project(manifestWith({ q: { dataset: "meals", select: ["nope"] } }), { "data/meals.csv": MEALS_CSV });
    const errors = await checkQueries(dir, await readManifest(dir));
    expect(errors.some((e) => e.query === "q" && e.field === "select")).toBe(true);
  });

  it("flags an orderBy field that is neither a column nor a select alias", async () => {
    const dir = project(
      manifestWith({ q: { dataset: "meals", select: ["name"], orderBy: [{ field: "nope", dir: "asc" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const errors = await checkQueries(dir, await readManifest(dir));
    expect(errors.some((e) => e.query === "q" && e.field === "orderBy")).toBe(true);
  });

  it("accepts an orderBy that names a select alias", async () => {
    const dir = project(
      manifestWith({ q: { dataset: "meals", select: [{ field: "kcal", fn: "sum", as: "total" }], orderBy: [{ field: "total", dir: "desc" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    expect(await checkQueries(dir, await readManifest(dir))).toEqual([]);
  });

  it("returns no errors for a valid query", async () => {
    const dir = project(
      manifestWith({ q: { dataset: "meals", select: ["name"], params: { n: { type: "number" } }, where: [{ field: "kcal", op: "gte", param: "n" }] } }),
      { "data/meals.csv": MEALS_CSV },
    );
    expect(await checkQueries(dir, await readManifest(dir))).toEqual([]);
  });

  it("flags a search field that is not a dataset column, naming it", async () => {
    const dir = project(
      manifestWith({ q: { dataset: "meals", params: { q: { type: "string" } }, search: { fields: ["name", "flavor"], param: "q" } } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const errors = await checkQueries(dir, await readManifest(dir));
    expect(errors.some((e) => e.query === "q" && e.field === "search" && e.message.includes("flavor"))).toBe(true);
  });

  it("flags a scoreField that collides with a dataset column", async () => {
    const dir = project(
      manifestWith({ q: { dataset: "meals", params: { q: { type: "string" } }, search: { fields: ["name"], param: "q", scoreField: "kcal" } } }),
      { "data/meals.csv": MEALS_CSV },
    );
    const errors = await checkQueries(dir, await readManifest(dir));
    expect(errors.some((e) => e.query === "q" && e.field === "search" && /collides with dataset column/.test(e.message))).toBe(true);
  });
});
