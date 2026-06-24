import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tableFromIPC } from "apache-arrow";
import { afterEach, describe, expect, it } from "vitest";
import {
  compile,
  distinctValues,
  inferFile,
  inferSchema,
  islandRequirements,
  query,
  queryArrow,
  queryRaw,
  resetEngine,
} from "../src/index.js";

const projects: string[] = [];
afterEach(() => {
  for (const dir of projects.splice(0)) resetEngine(dir);
});

function project(manifest: unknown, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-"));
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  mkdirSync(join(dir, "models"), { recursive: true });
  mkdirSync(join(dir, "content"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  projects.push(dir);
  return dir;
}

const FINANCE = join(import.meta.dirname, "..", "..", "..", "templates", "finance", "apps", "finance");

const baseManifest = {
  version: 1,
  title: "T",
  datasets: { nw: { source: "data/nw.csv" } },
  pages: [{ id: "p", islands: [{ type: "timeseries.line", title: "NW", dataset: "nw", x: "month", y: "value" }] }],
};

describe("islandRequirements", () => {
  it("extracts the dataset + fields a line chart needs", () => {
    const r = islandRequirements({ type: "timeseries.line", dataset: "nw", x: "month", y: ["a", "b"] });
    expect(r.dataset).toBe("nw");
    expect(r.fields.toSorted()).toEqual(["a", "b", "month"]);
  });
  it("returns no dataset for note islands", () => {
    expect(islandRequirements({ type: "note.card", markdown: "x" }).dataset).toBeNull();
  });
  it("binds content.editor to no dataset and no fields", () => {
    expect(islandRequirements({ type: "content.editor", dir: "data/x" })).toEqual({ dataset: null, fields: [] });
  });
  it("extracts detail fields for table.grid and timeline.feed", () => {
    const table = islandRequirements({
      type: "table.grid",
      dataset: "panel",
      columns: [{ field: "name" }],
      details: [{ field: "ref_low" }, { field: "ref_high", label: "Ref high" }],
    });
    expect(table.fields.toSorted()).toEqual(["name", "ref_high", "ref_low"]);

    const feed = islandRequirements({
      type: "timeline.feed",
      dataset: "meals",
      ts: "ts",
      titleField: "name",
      details: [{ field: "notes" }],
    });
    expect(feed.fields.toSorted()).toEqual(["name", "notes", "ts"]);
  });
  it("extracts groupBy field, titleField, and subtitleField for table.grid and timeline.feed", () => {
    const table = islandRequirements({
      type: "table.grid",
      dataset: "biomarkers",
      columns: [{ field: "name" }],
      groupBy: { field: "panel_id", titleField: "panel_name", subtitleField: "draw_date" },
    });
    expect(table.fields.toSorted()).toEqual(["draw_date", "name", "panel_id", "panel_name"]);

    const feed = islandRequirements({
      type: "timeline.feed",
      dataset: "events",
      ts: "ts",
      titleField: "name",
      groupBy: { field: "session_id" },
    });
    expect(feed.fields.toSorted()).toEqual(["name", "session_id", "ts"]);
  });
  it("extracts every ring's value and string max for gauge.rings, skipping numeric maxes", () => {
    const r = islandRequirements({
      type: "gauge.rings",
      dataset: "macros",
      rings: [
        { value: "protein_g", max: "protein_goal_g" },
        { value: "carb_g", max: 250 },
      ],
    });
    expect(r.dataset).toBe("macros");
    expect(r.fields.toSorted()).toEqual(["carb_g", "protein_g", "protein_goal_g"]);
  });

  it("extracts highlight, stats, and footer fields for timeline.feed", () => {
    const r = islandRequirements({
      type: "timeline.feed",
      dataset: "meals",
      ts: "at",
      titleField: "name",
      highlight: { field: "kcal" },
      stats: [{ field: "protein_g" }, { field: "carb_g" }],
      footer: [{ field: "tag" }],
    });
    expect(r.fields.toSorted()).toEqual(["at", "carb_g", "kcal", "name", "protein_g", "tag"]);
  });

  it("treats each drilldown.match value as a required parent field, not the match key", () => {
    const feed = islandRequirements({
      type: "timeline.feed",
      dataset: "meals",
      ts: "at",
      titleField: "name",
      drilldown: { island: { type: "table.grid", dataset: "components", columns: [{ field: "name" }] }, match: { meal_id: "id" } },
    });
    expect(feed.fields.toSorted()).toEqual(["at", "id", "name"]);

    const table = islandRequirements({
      type: "table.grid",
      dataset: "meals",
      columns: [{ field: "name" }],
      drilldown: { island: { type: "table.grid", dataset: "components" }, match: { meal_id: "row_id" } },
    });
    expect(table.fields.toSorted()).toEqual(["name", "row_id"]);
  });

  it("extracts every meter's value and string max for gauge.meter, skipping numeric maxes", () => {
    const r = islandRequirements({
      type: "gauge.meter",
      dataset: "usage",
      meters: [
        { value: "used_gb", max: "quota_gb" },
        { value: "req", max: 1000 },
      ],
    });
    expect(r.dataset).toBe("usage");
    expect(r.fields.toSorted()).toEqual(["quota_gb", "req", "used_gb"]);
  });

  it("extracts the match fields, titleField, and detail for search.box", () => {
    const r = islandRequirements({
      type: "search.box",
      dataset: "tracks",
      fields: ["name", "artist"],
      titleField: "name",
      detail: "album",
    });
    expect(r.dataset).toBe("tracks");
    expect(r.fields.toSorted()).toEqual(["album", "artist", "name"]);
  });

  it("extracts value and string goal bounds for gauge.goal, skipping numeric bounds", () => {
    const r = islandRequirements({
      type: "gauge.goal",
      dataset: "macros",
      goals: [{ value: "kcal", goal: { min: "kcal_low", max: 2600 } }],
    });
    expect(r.dataset).toBe("macros");
    expect(r.fields.toSorted()).toEqual(["kcal", "kcal_low"]);
  });
});

const gaugeManifest = (rings: unknown[]) => ({
  version: 1,
  title: "T",
  datasets: { macros: { source: "data/macros.csv" } },
  pages: [{ id: "today", islands: [{ type: "gauge.rings", title: "Macros", dataset: "macros", rings }] }],
});

describe("compile (gauge.rings contract check)", () => {
  it("passes when every ring binding resolves", async () => {
    const dir = project(gaugeManifest([{ value: "protein_g", max: "protein_goal_g" }, { value: "carb_g", max: 250 }]), {
      "data/macros.csv": "date,protein_g,protein_goal_g,carb_g\n2026-01-01,120,180,200\n",
    });
    const report = await compile(dir);
    expect(report.ok, report.errors.join(" ")).toBe(true);
  });

  it("fails naming the island and the missing ring column", async () => {
    const dir = project(gaugeManifest([{ value: "protein_g", max: "ghost_goal" }]), {
      "data/macros.csv": "date,protein_g\n2026-01-01,120\n",
    });
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const failed = report.islandChecks.find((c) => c.type === "gauge.rings");
    expect(failed!.ok).toBe(false);
    expect(failed!.missingFields).toContain("ghost_goal");
    expect(report.errors.join(" ")).toContain("[today#0 gauge.rings]");
  });
});

describe("compile (golden fixture)", () => {
  it("materializes a snapshot and passes the contract check", async () => {
    const dir = project(baseManifest, { "data/nw.csv": "month,value\n2026-01,100\n2026-02,120\n" });
    const report = await compile(dir);
    expect(report.ok).toBe(true);
    expect(report.snapshots.nw!.rows).toEqual([
      { month: "2026-01", value: 100 },
      { month: "2026-02", value: 120 },
    ]);
    expect(report.snapshots.nw!.columns).toEqual([
      { name: "month", type: "string" },
      { name: "value", type: "number" },
    ]);
    expect(report.islandChecks[0]!.ok).toBe(true);
  });
});

describe("compile (contract mismatch)", () => {
  it("fails loudly naming the island and the missing field", async () => {
    const dir = project(baseManifest, { "data/nw.csv": "month,total\n2026-01,100\n" });
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const joined = report.errors.join(" ");
    expect(joined).toContain("missing field");
    expect(joined).toContain("value");
    expect(joined).toContain("timeseries.line");
    expect(report.islandChecks[0]!.missingFields).toContain("value");
  });
});

const formManifest = (island: Record<string, unknown>, actions: Record<string, unknown>) => ({
  version: 1,
  title: "T",
  datasets: { meals: { source: "data/meals.csv" } },
  pages: [{ id: "p", islands: [{ type: "form.entry", ...island }] }],
  actions,
});
const MEALS = "name,kcal,logged\nOatmeal,300,2026-01-01\n";

describe("compile (form.entry contract check)", () => {
  it("passes when the action is declared and every listed field is a real column", async () => {
    const dir = project(
      formManifest({ action: "log_meal", fields: ["name", "kcal"] }, { log_meal: { dataset: "meals", mode: "insert" } }),
      { "data/meals.csv": MEALS },
    );
    const report = await compile(dir);
    expect(report.ok, report.errors.join(" ")).toBe(true);
  });

  it("fails naming an unknown action", async () => {
    const dir = project(formManifest({ action: "ghost" }, { log_meal: { dataset: "meals", mode: "insert" } }), {
      "data/meals.csv": MEALS,
    });
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const joined = report.errors.join(" ");
    expect(joined).toContain("unknown action");
    expect(joined).toContain("[p#0 form.entry]");
  });

  it("fails naming a form field that is not a column of the action's dataset", async () => {
    const dir = project(
      formManifest({ action: "log_meal", fields: ["name", "protein"] }, { log_meal: { dataset: "meals", mode: "insert" } }),
      { "data/meals.csv": MEALS },
    );
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const joined = report.errors.join(" ");
    expect(joined).toContain("is not a column");
    expect(joined).toContain("protein");
    const failed = report.islandChecks.find((c) => c.type === "form.entry");
    expect(failed!.missingFields).toContain("protein");
  });
});

describe("compile (grouped page)", () => {
  const groupedManifest = {
    version: 1,
    title: "T",
    datasets: { nw: { source: "data/nw.csv" } },
    pages: [
      {
        id: "p",
        groups: [
          {
            id: "headline",
            islands: [{ type: "metric.kpi", title: "NW", dataset: "nw", value: "value" }],
          },
          {
            id: "trends",
            islands: [{ type: "timeseries.line", title: "Trend", dataset: "nw", x: "month", y: "value" }],
          },
        ],
      },
    ],
  };

  it("passes the contract check when every grouped binding resolves", async () => {
    const dir = project(groupedManifest, { "data/nw.csv": "month,value\n2026-01,100\n2026-02,120\n" });
    const report = await compile(dir);
    expect(report.ok, report.errors.join(" ")).toBe(true);
    expect(report.islandChecks.map((c) => c.index)).toEqual([0, 1]);
  });

  it("fails naming the right page + flat index for a binding error inside a group", async () => {
    const dir = project(groupedManifest, { "data/nw.csv": "month,total\n2026-01,100\n" });
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const failed = report.islandChecks.find((c) => c.type === "timeseries.line");
    expect(failed!.ok).toBe(false);
    expect(failed!.page).toBe("p");
    expect(failed!.index).toBe(1); // running index across group "headline" (index 0)
    expect(failed!.missingFields).toContain("value");
    const joined = report.errors.join(" ");
    expect(joined).toContain("[p#1 timeseries.line]");
    expect(joined).toContain("value");
  });
});

describe("compile (layout.row)", () => {
  it("passes the contract check and reports the correct flat index for a missing field inside a row", async () => {
    const dir = project(
      {
        version: 1,
        title: "T",
        datasets: { nw: { source: "data/nw.csv" } },
        pages: [{
          id: "p",
          islands: [
            { type: "metric.kpi", title: "KPI", dataset: "nw", value: "value" },
            {
              type: "layout.row",
              id: "row1",
              islands: [
                { type: "timeseries.line", title: "Trend", dataset: "nw", x: "month", y: "ghost" },
              ],
            },
          ],
        }],
      },
      { "data/nw.csv": "month,value\n2026-01,100\n" },
    );
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const err = report.errors.find((e) => e.includes("ghost"));
    expect(err).toBeDefined();
    expect(err).toContain("[p#1 timeseries.line]");
  });
});

describe("query (read-only + row cap)", () => {
  it("converts BigInt and date types to JSON-able scalars", async () => {
    const dir = project(baseManifest, { "data/nw.csv": "month,value\n2026-01,100\n" });
    const result = await query(dir, "nw");
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.columns).toEqual([
      { name: "month", type: "string" },
      { name: "value", type: "number" },
    ]);
  });

  it("applies the row cap", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => `2026-01,${i}`).join("\n");
    const dir = project(baseManifest, { "data/nw.csv": `month,value\n${rows}\n` });
    const result = await query(dir, "nw", { limit: 10 });
    expect(result.rows).toHaveLength(10);
  });

  it("rejects DDL/DML statements", async () => {
    const dir = project(baseManifest, { "data/nw.csv": "month,value\n2026-01,100\n" });
    await expect(queryRaw(dir, "DROP VIEW nw")).rejects.toThrow(/read-only/);
    await expect(queryRaw(dir, "CREATE TABLE x(a INT)")).rejects.toThrow(/read-only/);
    await expect(queryRaw(dir, "SELECT 1; SELECT 2")).rejects.toThrow(/single/);
  });

  it("allows a read-only SELECT through queryRaw", async () => {
    const dir = project(baseManifest, { "data/nw.csv": "month,value\n2026-01,100\n2026-02,120\n" });
    const result = await queryRaw(dir, "SELECT SUM(value) AS total FROM nw");
    expect(result.rows[0]!.total).toBe(220);
  });
});

describe("compile (sql transform dataset)", () => {
  it("registers a sql view joining two CSVs and checks bindings against it", async () => {
    const manifest = {
      version: 1,
      title: "T",
      datasets: { joined: { sql: "models/joined.sql" } },
      pages: [{ id: "p", islands: [{ type: "category.bar", title: "B", dataset: "joined", x: "class", y: "total_eur" }] }],
    };
    const dir = project(manifest, {
      "data/holdings.csv": "asset,class,value_eur\nBTC,Crypto,900\nETH,Crypto,300\nVOO,Equities,500\n",
      "data/targets.csv": "class,target_pct\nCrypto,70\nEquities,30\n",
      "models/joined.sql":
        "SELECT h.class, SUM(h.value_eur) AS total_eur, ANY_VALUE(t.target_pct) AS target_pct " +
        "FROM read_csv_auto('" +
        join("data", "holdings.csv") +
        "') h JOIN read_csv_auto('" +
        join("data", "targets.csv") +
        "') t ON h.class = t.class GROUP BY h.class",
    });
    const report = await compile(dir);
    expect(report.ok).toBe(true);
    expect(report.snapshots.joined!.rows.find((r) => r.class === "Crypto")!.total_eur).toBe(1200);
  });
});

describe("compile (details contract check)", () => {
  it("fails naming the island and the missing detail column", async () => {
    const manifest = {
      version: 1,
      title: "T",
      datasets: { panel: { source: "data/panel.csv" } },
      pages: [{
        id: "trends",
        islands: [{
          type: "table.grid",
          title: "Panel",
          dataset: "panel",
          columns: [{ field: "name" }],
          details: [{ field: "ghost_ref" }],
        }],
      }],
    };
    const dir = project(manifest, { "data/panel.csv": "name,value\nLDL,99\n" });
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const failed = report.islandChecks.find((c) => c.type === "table.grid");
    expect(failed!.ok).toBe(false);
    expect(failed!.missingFields).toContain("ghost_ref");
    expect(report.errors.join(" ")).toContain("[trends#0 table.grid]");
  });
});

describe("compile (groupBy contract check)", () => {
  it("fails naming the island and the missing groupBy column", async () => {
    const manifest = {
      version: 1,
      title: "T",
      datasets: { panels: { source: "data/panels.csv" } },
      pages: [{
        id: "trends",
        islands: [{
          type: "table.grid",
          title: "Panels",
          dataset: "panels",
          columns: [{ field: "name" }],
          groupBy: { field: "ghost_panel", titleField: "panel_name" },
        }],
      }],
    };
    const dir = project(manifest, { "data/panels.csv": "name,value,panel_name\nLDL,99,Draw\n" });
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const failed = report.islandChecks.find((c) => c.type === "table.grid");
    expect(failed!.ok).toBe(false);
    expect(failed!.missingFields).toContain("ghost_panel");
    expect(report.errors.join(" ")).toContain("[trends#0 table.grid]");
  });

  it("passes when every groupBy binding resolves", async () => {
    const manifest = {
      version: 1,
      title: "T",
      datasets: { panels: { source: "data/panels.csv" } },
      pages: [{
        id: "trends",
        islands: [{
          type: "table.grid",
          title: "Panels",
          dataset: "panels",
          columns: [{ field: "name" }],
          groupBy: { field: "panel_id", titleField: "panel_name", subtitleField: "draw_date" },
        }],
      }],
    };
    const dir = project(manifest, {
      "data/panels.csv": "panel_id,panel_name,draw_date,name\np1,Draw,2026-01-01,LDL\n",
    });
    const report = await compile(dir);
    expect(report.ok, report.errors.join(" ")).toBe(true);
  });
});

const sqliteManifest = (table: string) => ({
  version: 1,
  title: "T",
  datasets: { tracks: { source: "data/library.sqlite", table } },
  pages: [{
    id: "p",
    islands: [{ type: "search.box", title: "Tracks", dataset: "tracks", fields: ["name", "artist"], titleField: "name" }],
  }],
});

async function sqliteProject(table: string): Promise<string> {
  const dir = project(sqliteManifest(table), {});
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(dir, "data", "library.sqlite"));
  db.exec("CREATE TABLE tracks (id INTEGER, name TEXT, artist TEXT)");
  db.exec("INSERT INTO tracks VALUES (1, 'Alpha', 'Ann'), (2, 'Beta', 'Bob')");
  db.close();
  return dir;
}

describe("compile (sqlite dataset)", () => {
  it("registers a sqlite table as a queryable view and passes the contract check", async () => {
    const dir = await sqliteProject("tracks");
    const report = await compile(dir);
    expect(report.ok, report.errors.join(" ")).toBe(true);
    expect(report.snapshots.tracks!.rows).toEqual([
      { id: 1, name: "Alpha", artist: "Ann" },
      { id: 2, name: "Beta", artist: "Bob" },
    ]);
    const result = await query(dir, "tracks", { match: [{ field: "artist", value: "Bob" }] });
    expect(result.rows.map((r) => r.name)).toEqual(["Beta"]);
  });

  it("fails loudly on a missing table", async () => {
    const dir = await sqliteProject("ghosts");
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("ghosts");
  });

  it("fails compile when a sqlite dataset omits its table", async () => {
    const manifest = sqliteManifest("tracks") as { datasets: { tracks: Record<string, unknown> } };
    delete manifest.datasets.tracks.table;
    const dir = project(manifest, {});
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("sqlite source needs a 'table'");
  });
});

describe("compile (markdown dataset)", () => {
  it("parses front-matter + body into a queryable view", async () => {
    const manifest = {
      version: 1,
      title: "T",
      datasets: { notes: { source: "content/strategy.md" } },
      pages: [{ id: "p", islands: [{ type: "table.grid", title: "N", dataset: "notes", columns: [{ field: "owner" }, { field: "body" }] }] }],
    };
    const dir = project(manifest, {
      "content/strategy.md": "---\nowner: luka\nprio: 3\n---\n# Plan\n\nStay rich.\n",
    });
    const report = await compile(dir);
    expect(report.ok).toBe(true);
    const row = report.snapshots.notes!.rows[0]!;
    expect(row.owner).toBe("luka");
    expect(row.prio).toBe(3);
    expect(row.file).toBe("strategy.md");
    expect(String(row.body)).toContain("Stay rich");
  });
});

describe("inferSchema", () => {
  it("reports columns + mapped types for a registered dataset", async () => {
    const dir = project(baseManifest, { "data/nw.csv": "month,value\n2026-01,100\n" });
    const schema = await inferSchema(dir, "nw");
    expect(schema.columns).toEqual([
      { name: "month", type: "string" },
      { name: "value", type: "number" },
    ]);
  });
});

describe("inferFile", () => {
  it("infers column names + types from a loose CSV with no project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oi-loose-"));
    const csv = join(dir, "metrics.csv");
    writeFileSync(csv, "day,visits,active\n2026-01-01,42,true\n");
    const schema = await inferFile(csv);
    expect(schema.dataset).toBe("metrics");
    expect(schema.columns).toEqual([
      { name: "day", type: "date" },
      { name: "visits", type: "number" },
      { name: "active", type: "boolean" },
    ]);
  });

  it("rejects a sqlite path, pointing at the project-dataset table path", async () => {
    await expect(inferFile("/tmp/library.sqlite")).rejects.toThrow(/table/);
  });
});

describe("acceptance: breaking a binding fails validate", () => {
  it("renaming net_worth_eur in the finance CSV names the bound island + field", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oi-finance-"));
    projects.push(dir);
    cpSync(FINANCE, dir, { recursive: true });
    const csvPath = join(dir, "data", "net_worth_monthly.csv");
    const broken = readFileSync(csvPath, "utf8").replace("net_worth_eur", "total_eur");
    writeFileSync(csvPath, broken);
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const failed = report.islandChecks.filter((c) => !c.ok);
    expect(failed.some((c) => c.dataset === "net_worth_monthly" && c.missingFields.includes("net_worth_eur"))).toBe(true);
    const joined = report.errors.join(" ");
    expect(joined).toContain("net_worth_eur");
    expect(joined).toContain("net_worth_monthly");
  });
});

describe("queryArrow", () => {
  it("serializes a dataset as a parseable Arrow IPC stream with typed columns", async () => {
    resetEngine(FINANCE);
    const bytes = await queryArrow(FINANCE, "holdings");
    expect(bytes).toBeInstanceOf(Uint8Array);
    const table = tableFromIPC(bytes);
    expect(table.numRows).toBeGreaterThan(0);
    const byName = Object.fromEntries(table.schema.fields.map((f) => [f.name, String(f.type)]));
    expect(byName.value_eur).toBe("Float64");
    expect(byName.asset).toBe("Utf8");
    resetEngine(FINANCE);
  });

  it("matches the JSON query row count for the same dataset", async () => {
    resetEngine(FINANCE);
    const json = await query(FINANCE, "holdings");
    const table = tableFromIPC(await queryArrow(FINANCE, "holdings"));
    expect(table.numRows).toBe(json.rows.length);
    resetEngine(FINANCE);
  });
});

describe("warm query performance", () => {
  it("returns a finance dataset in <100ms warm", async () => {
    resetEngine(FINANCE);
    await query(FINANCE, "net_worth_monthly"); // warm the engine
    const start = performance.now();
    const result = await query(FINANCE, "net_worth_monthly");
    const elapsed = performance.now() - start;
    expect(result.rows.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
    resetEngine(FINANCE);
  });
});

describe("range queries", () => {
  it("narrows rows on a DATE column (typed cast)", async () => {
    const dir = project(baseManifest, { "data/nw.csv": "month,value\n2026-01-01\n" });
    writeFileSync(join(dir, "data", "nw.csv"), "ts,value\n2026-01-15,1\n2026-02-15,2\n2026-03-15,3\n");
    resetEngine(dir);
    const all = await query(dir, "nw");
    expect(all.columns.find((c) => c.name === "ts")!.type).toBe("date");
    const narrowed = await query(dir, "nw", { range: { field: "ts", from: "2026-02-01", to: "2026-02-28" } });
    expect(narrowed.rows.map((r) => r.value)).toEqual([2]);
  });

  it("narrows rows on a VARCHAR month column with a YYYY-MM-DD bound inside the month", async () => {
    const dir = project(baseManifest, { "data/nw.csv": "month,value\n2026-01,1\n2026-02,2\n2026-03,3\n" });
    expect((await query(dir, "nw")).columns.find((c) => c.name === "month")!.type).toBe("string");
    // a 'YYYY-MM' value is matched against the YYYY-MM prefix of the bound, so a
    // mid-month from/to still includes that whole month.
    expect((await query(dir, "nw", { range: { field: "month", from: "2026-02-15" } })).rows.map((r) => r.value)).toEqual([2, 3]);
    expect((await query(dir, "nw", { range: { field: "month", from: "2026-02-01", to: "2026-02-28" } })).rows.map((r) => r.value)).toEqual([2]);
  });

  it("applies the row cap to a ranged query", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, "0")},${i}`).join("\n");
    const dir = project(baseManifest, { "data/nw.csv": `ts,value\n${rows}\n` });
    const capped = await query(dir, "nw", { limit: 5, range: { field: "ts", from: "2026-01-01" } });
    expect(capped.rows).toHaveLength(5);
  });

  it("rejects an unknown range field loudly without executing", async () => {
    const dir = project(baseManifest, { "data/nw.csv": "month,value\n2026-01,1\n" });
    await expect(query(dir, "nw", { range: { field: 'x" OR 1=1 --', from: "2026-01-01" } })).rejects.toThrow(
      /range field .* not found/,
    );
  });
});

describe("select queries", () => {
  const csv = "category,value\nA,1\nB,2\nC,3\nA,4\n";

  it("narrows on a single value with an equality match", async () => {
    const dir = project(baseManifest, { "data/nw.csv": csv });
    const narrowed = await query(dir, "nw", { select: [{ field: "category", values: ["A"] }] });
    expect(narrowed.rows.map((r) => r.value)).toEqual([1, 4]);
  });

  it("narrows on multiple values with an IN match", async () => {
    const dir = project(baseManifest, { "data/nw.csv": csv });
    const narrowed = await query(dir, "nw", { select: [{ field: "category", values: ["A", "C"] }] });
    expect(narrowed.rows.map((r) => r.value)).toEqual([1, 3, 4]);
  });

  it("ignores an all-empty selection and returns every row", async () => {
    const dir = project(baseManifest, { "data/nw.csv": csv });
    const all = await query(dir, "nw", { select: [{ field: "category", values: [] }] });
    expect(all.rows).toHaveLength(4);
  });

  it("binds a select value as a parameter, not interpolated SQL (injection-safe)", async () => {
    const dir = project(baseManifest, { "data/nw.csv": csv });
    const injected = await query(dir, "nw", { select: [{ field: "category", values: ["x' OR '1'='1"] }] });
    expect(injected.rows).toHaveLength(0);
  });

  it("rejects an unknown select field loudly via verifyField", async () => {
    const dir = project(baseManifest, { "data/nw.csv": csv });
    await expect(query(dir, "nw", { select: [{ field: "nope", values: ["A"] }] })).rejects.toThrow(
      /select field 'nope' not found/,
    );
  });
});

describe("distinctValues", () => {
  const csv = "category,value\nB,1\nA,2\nA,3\nC,4\n";

  it("returns the sorted distinct non-null values of a column", async () => {
    const dir = project(baseManifest, { "data/nw.csv": csv });
    expect(await distinctValues(dir, "nw", "category")).toEqual(["A", "B", "C"]);
  });

  it("respects the row cap limit", async () => {
    const dir = project(baseManifest, { "data/nw.csv": csv });
    expect(await distinctValues(dir, "nw", "category", { limit: 2 })).toEqual(["A", "B"]);
  });

  it("rejects an unknown column loudly via verifyField", async () => {
    const dir = project(baseManifest, { "data/nw.csv": csv });
    await expect(distinctValues(dir, "nw", "nope")).rejects.toThrow(/distinct column 'nope' not found/);
  });
});

const drilldownManifest = (drilldown: unknown) => ({
  version: 1,
  title: "T",
  datasets: { meals: { source: "data/meals.csv" }, components: { source: "data/components.csv" } },
  pages: [{ id: "log", islands: [{ type: "timeline.feed", title: "Meals", dataset: "meals", ts: "at", titleField: "name", drilldown }] }],
});

describe("compile (drilldown contract check)", () => {
  const files = {
    "data/meals.csv": "id,at,name\n1,2026-01-01,Lunch\n2,2026-01-02,Dinner\n",
    "data/components.csv": "meal_id,name,grams\n1,Rice,200\n1,Chicken,150\n2,Pasta,180\n",
  };

  it("passes when the drilldown island, its dataset, and match keys all resolve", async () => {
    const dir = project(
      drilldownManifest({ island: { type: "table.grid", dataset: "components", columns: [{ field: "name" }, { field: "grams" }] }, match: { meal_id: "id" } }),
      files,
    );
    const report = await compile(dir);
    expect(report.ok, report.errors.join(" ")).toBe(true);
  });

  it("fails at the parent index naming a bad match key", async () => {
    const dir = project(
      drilldownManifest({ island: { type: "table.grid", dataset: "components", columns: [{ field: "name" }] }, match: { ghost_id: "id" } }),
      files,
    );
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const joined = report.errors.join(" ");
    expect(joined).toContain("[log#0 timeline.feed]");
    expect(joined).toContain("drilldown (timeline.feed)");
    expect(joined).toContain("ghost_id");
  });

  it("fails naming a missing field of the drilldown island's own dataset", async () => {
    const dir = project(
      drilldownManifest({ island: { type: "table.grid", dataset: "components", columns: [{ field: "ghost_col" }] }, match: { meal_id: "id" } }),
      files,
    );
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const joined = report.errors.join(" ");
    expect(joined).toContain("[log#0 timeline.feed]");
    expect(joined).toContain("ghost_col");
  });

  it("fails naming an unknown drilldown dataset", async () => {
    const dir = project(
      drilldownManifest({ island: { type: "table.grid", dataset: "ghosts", columns: [{ field: "name" }] }, match: { meal_id: "id" } }),
      files,
    );
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const joined = report.errors.join(" ");
    expect(joined).toContain("[log#0 timeline.feed]");
    expect(joined).toContain("ghosts");
  });
});

describe("query (match equality narrowing)", () => {
  const componentsManifest = {
    version: 1,
    title: "T",
    datasets: { components: { source: "data/components.csv" } },
    pages: [{ id: "p", islands: [{ type: "table.grid", title: "C", dataset: "components" }] }],
  };

  it("returns only rows matching, casting numeric id columns to string", async () => {
    const dir = project(componentsManifest, { "data/components.csv": "meal_id,name\n1,Rice\n1,Chicken\n2,Pasta\n" });
    const result = await query(dir, "components", { match: [{ field: "meal_id", value: "1" }] });
    expect(result.rows.map((r) => r.name)).toEqual(["Rice", "Chicken"]);
  });

  it("rejects an unknown match field loudly without executing", async () => {
    const dir = project(componentsManifest, { "data/components.csv": "meal_id,name\n1,Rice\n" });
    await expect(query(dir, "components", { match: [{ field: 'x" OR 1=1 --', value: "1" }] })).rejects.toThrow(
      /match field .* not found/,
    );
  });
});

const filterManifest = (bind: Record<string, string>) => ({
  version: 1,
  title: "T",
  datasets: { nw: { source: "data/nw.csv" } },
  pages: [
    {
      id: "p",
      filters: [{ id: "period", type: "daterange", bind }],
      islands: [{ type: "timeseries.line", title: "NW", dataset: "nw", x: "month", y: "value" }],
    },
  ],
});

describe("page filter contract check", () => {
  it("passes when the filter binds an existing column", async () => {
    const dir = project(filterManifest({ nw: "month" }), { "data/nw.csv": "month,value\n2026-01,1\n" });
    const report = await compile(dir);
    expect(report.ok).toBe(true);
  });

  it("fails naming page + filter + dataset + column on a missing bind column", async () => {
    const dir = project(filterManifest({ nw: "ghost" }), { "data/nw.csv": "month,value\n2026-01,1\n" });
    const report = await compile(dir);
    expect(report.ok).toBe(false);
    const err = report.errors.find((e) => e.includes("filter 'period'"));
    expect(err).toMatch(/\bp\b/);
    expect(err).toContain("nw");
    expect(err).toContain("ghost");
  });
});

describe("security: ad-hoc SQL is confined to registered views", () => {
  const withNw = () =>
    project(baseManifest, { "data/nw.csv": "month,value\n2024-01,10\n2024-02,20\n", "data/stray.csv": "x\n9\n" });

  it("runs a plain SELECT and a CTE over the registered views", async () => {
    const dir = withNw();
    expect((await queryRaw(dir, "SELECT * FROM nw")).rows).toHaveLength(2);
    expect((await queryRaw(dir, "WITH t AS (SELECT * FROM nw WHERE value > 10) SELECT * FROM t")).rows).toHaveLength(1);
  });

  it("rejects a file-reading table function (arbitrary read / SSRF gadget)", async () => {
    const dir = withNw();
    await expect(queryRaw(dir, "SELECT * FROM read_text('/etc/hosts')")).rejects.toThrow(/table function/i);
  });

  it("rejects a base table that isn't a registered view (replacement-scan file read)", async () => {
    const dir = withNw();
    await expect(queryRaw(dir, "SELECT * FROM 'data/stray.csv'")).rejects.toThrow(/not a known dataset/i);
  });
});

describe("security: manifest dataset sources are confined", () => {
  it("refuses a source that escapes the project root", async () => {
    const dir = project({ ...baseManifest, datasets: { nw: { source: "/etc/passwd" } } }, {});
    await expect(query(dir, "nw")).rejects.toThrow(/outside the project root/i);
  });

  it("refuses a dotfile/secret source", async () => {
    const dir = project({ ...baseManifest, datasets: { nw: { source: ".env" } } }, { ".env": "SECRET=1\n" });
    await expect(query(dir, "nw")).rejects.toThrow(/protected file/i);
  });
});
