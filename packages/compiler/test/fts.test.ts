import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { invalidateEngineDatasets, resetEngine, runQuery } from "../src/index.js";

const projects: string[] = [];
afterEach(() => {
  for (const dir of projects.splice(0)) resetEngine(dir);
});

function project(manifest: unknown, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-fts-"));
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  projects.push(dir);
  return dir;
}

const INGREDIENTS_CSV =
  "name,brand,kcal\n" +
  "Greek Yogurt,Fage,59\n" +
  "Olympus Greek Olives,Olympus,145\n" +
  "Olympus Yogurt,Olympus,61\n" +
  "Banana,Generic,89\n";

function manifestWith(search: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    title: "T",
    datasets: { ingredients: { source: "data/ingredients.csv" } },
    pages: [{ id: "p", islands: [{ type: "table.grid", title: "Ingredients", dataset: "ingredients" }] }],
    queries: {
      search_x: {
        dataset: "ingredients",
        params: { q: { type: "string" } },
        search: { fields: ["name", "brand"], param: "q", ...search },
        ...extra,
      },
    },
  };
}

describe("FTS relevance ranking", () => {
  it("ranks a stronger token match above a weaker one and excludes non-matches", async () => {
    const dir = project(manifestWith({}), { "data/ingredients.csv": INGREDIENTS_CSV });
    const result = await runQuery(dir, "search_x", { q: "greek yogurt" });
    const names = result.rows.map((r) => r.name);
    expect(names).not.toContain("Banana");
    expect(names.indexOf("Greek Yogurt")).toBeLessThan(names.indexOf("Olympus Yogurt"));
  });

  it("exposes the BM25 score under scoreField, descending", async () => {
    const dir = project(manifestWith({ scoreField: "relevance" }), { "data/ingredients.csv": INGREDIENTS_CSV });
    const result = await runQuery(dir, "search_x", { q: "greek yogurt" });
    const scores = result.rows.map((r) => r.relevance as number);
    expect(scores.length).toBeGreaterThan(1);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe("invalidateEngineDatasets (warm re-register)", () => {
  it("reflects a row appended to a non-FTS dataset's source", async () => {
    const manifest = {
      version: 1,
      title: "T",
      datasets: { meals: { source: "data/meals.csv" } },
      pages: [{ id: "p", islands: [{ type: "table.grid", title: "Meals", dataset: "meals" }] }],
      queries: { by_name: { dataset: "meals", select: ["kcal"], params: { name: { type: "string" } }, where: [{ field: "name", op: "eq", param: "name" }] } },
    };
    const dir = project(manifest, { "data/meals.csv": "name,kcal\nEggs,200\n" });

    expect((await runQuery(dir, "by_name", { name: "Toast" })).rows).toHaveLength(0);

    appendFileSync(join(dir, "data", "meals.csv"), "Toast,150\n");
    await invalidateEngineDatasets(dir, ["meals"]);

    expect((await runQuery(dir, "by_name", { name: "Toast" })).rows).toEqual([{ kcal: 150 }]);
  });

  it("rebuilds the FTS sidecar so a new row in an indexed source is searchable", async () => {
    const dir = project(manifestWith({}), { "data/ingredients.csv": INGREDIENTS_CSV });

    expect((await runQuery(dir, "search_x", { q: "skyr" })).rows).toHaveLength(0);

    appendFileSync(join(dir, "data", "ingredients.csv"), "Icelandic Skyr,Siggis,63\n");
    await invalidateEngineDatasets(dir, ["ingredients"]);

    const result = await runQuery(dir, "search_x", { q: "skyr" });
    expect(result.rows.map((r) => r.name)).toContain("Icelandic Skyr");
  });
});
