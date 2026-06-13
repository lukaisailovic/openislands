import { describe, expect, it } from "vitest";
import {
  BUILTIN_ISLAND_SCHEMAS,
  BUILTIN_ISLAND_TYPES,
  flattenPageIslands,
  type IslandType,
  type Page,
  jsonSchemaFor,
  manifestJsonSchema,
  validateManifest,
} from "../src/index.js";

const goodManifest = {
  version: 1,
  title: "Finance Overview",
  datasets: { net_worth: { source: "data/net_worth.csv" } },
  pages: [
    {
      id: "overview",
      islands: [
        { type: "metric.kpi", title: "Net worth", dataset: "net_worth", value: "net_worth_eur" },
        { type: "timeseries.line", title: "Net worth over time", dataset: "net_worth", x: "month", y: "net_worth_eur" },
      ],
    },
  ],
};

describe("validateManifest", () => {
  it("accepts a well-formed manifest and applies defaults", () => {
    const r = validateManifest(goodManifest);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    const kpi = r.manifest!.pages[0]!.islands[0]! as { compareTo?: string };
    expect(kpi.compareTo).toBe("none"); // default applied
  });

  it("fails loudly and names the broken island", () => {
    const bad = structuredClone(goodManifest);
    delete (bad.pages[0]!.islands[0] as Record<string, unknown>).value;
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.type).toBe("metric.kpi");
    expect(r.errors[0]!.page).toBe("overview");
    expect(r.errors[0]!.index).toBe(0);
  });

  it("populates the offending field path on island errors", () => {
    const bad = structuredClone(goodManifest);
    delete (bad.pages[0]!.islands[0] as Record<string, unknown>).value;
    const r = validateManifest(bad);
    expect(r.errors[0]!.field).toBe("value");
  });

  it("reports a nested option path in field", () => {
    const bad = structuredClone(goodManifest);
    (bad.pages[0]!.islands[1] as Record<string, unknown>).options = { goalField: 42 };
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "options.goalField")).toBe(true);
  });

  it("reports an invalid format enum value with its field path", () => {
    const bad = structuredClone(goodManifest);
    (bad.pages[0]!.islands[0] as Record<string, unknown>).format = "usd";
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "format")).toBe(true);
  });

  it("rejects a dataset with neither source nor sql", () => {
    const bad = structuredClone(goodManifest);
    bad.datasets.net_worth = {} as never;
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes("source"))).toBe(true);
  });

  it("accepts a dataset declared with a sql transform", () => {
    const withSql = structuredClone(goodManifest);
    withSql.datasets.net_worth = { sql: "models/net_worth.sql" } as never;
    const r = validateManifest(withSql);
    expect(r.ok).toBe(true);
  });

  it("accepts a sqlite dataset declaring its table", () => {
    const m = structuredClone(goodManifest);
    m.datasets.net_worth = { source: "data/library.sqlite", table: "tracks" } as never;
    const r = validateManifest(m);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  });

  it("rejects a sqlite dataset without a table", () => {
    for (const source of ["data/library.sqlite", "data/library.db"]) {
      const m = structuredClone(goodManifest);
      m.datasets.net_worth = { source } as never;
      const r = validateManifest(m);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => /datasets\.net_worth.*sqlite source needs a 'table'/.test(e.message))).toBe(true);
    }
  });

  it("rejects a table on a non-sqlite dataset", () => {
    const m = structuredClone(goodManifest);
    m.datasets.net_worth = { source: "data/net_worth.csv", table: "tracks" } as never;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /datasets\.net_worth.*'table' only applies/.test(e.message))).toBe(true);
  });

  it("rejects a table on a sql dataset", () => {
    const m = structuredClone(goodManifest);
    m.datasets.net_worth = { sql: "models/x.sql", table: "tracks" } as never;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /datasets\.net_worth.*'table' only applies/.test(e.message))).toBe(true);
  });

  it("treats unknown island types as custom (the extension point), not errors", () => {
    const withCustom = structuredClone(goodManifest);
    withCustom.pages[0]!.islands.push({ type: "gauge.ring", title: "Macros", dataset: "net_worth" } as never);
    const r = validateManifest(withCustom);
    expect(r.ok).toBe(true);
    expect(r.custom).toHaveLength(1);
    expect(r.custom[0]!.type).toBe("gauge.ring");
  });

  it("rejects an unsupported version", () => {
    const r = validateManifest({ ...goodManifest, version: 2 });
    expect(r.ok).toBe(false);
  });
});

// --- Pages, groups, icons -------------------------------------------------------

const groupedManifest = {
  version: 1,
  title: "Finance Overview",
  datasets: { net_worth: { source: "data/net_worth.csv" } },
  pages: [
    {
      id: "overview",
      title: "Overview",
      icon: "wallet",
      groups: [
        {
          id: "headline",
          title: "Headline",
          islands: [
            { type: "metric.kpi", title: "Net worth", dataset: "net_worth", value: "net_worth_eur" },
            { type: "metric.kpi", title: "Cash", dataset: "net_worth", value: "cash_eur" },
          ],
        },
        {
          id: "trends",
          title: "Trends",
          islands: [
            { type: "timeseries.line", title: "Net worth over time", dataset: "net_worth", x: "month", y: "net_worth_eur" },
          ],
        },
      ],
    },
  ],
};

describe("validateManifest — grouped pages", () => {
  it("accepts a grouped page and preserves groups with parsed islands", () => {
    const r = validateManifest(groupedManifest);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    const page = r.manifest!.pages[0]!;
    expect(page.islands).toBeUndefined();
    expect(page.groups).toHaveLength(2);
    expect(page.icon).toBe("wallet");
    expect(page.groups![0]!.id).toBe("headline");
    expect(page.groups![1]!.islands).toHaveLength(1);
    const kpi = page.groups![0]!.islands[0]! as { compareTo?: string };
    expect(kpi.compareTo).toBe("none"); // default applied inside groups
  });

  it("flattenPageIslands returns a flat running index across groups with groupIds", () => {
    const r = validateManifest(groupedManifest);
    const flat = flattenPageIslands(r.manifest!.pages[0]!);
    expect(flat.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(flat.map((f) => f.groupId)).toEqual(["headline", "headline", "trends"]);
    expect((flat[2]!.island as { type: string }).type).toBe("timeseries.line");
  });

  it("flattenPageIslands leaves a flat page unchanged with no groupIds", () => {
    const r = validateManifest(goodManifest);
    const flat = flattenPageIslands(r.manifest!.pages[0]!);
    expect(flat.map((f) => f.index)).toEqual([0, 1]);
    expect(flat.every((f) => f.groupId === undefined)).toBe(true);
  });

  it("accepts a page with a valid icon", () => {
    const m = structuredClone(goodManifest) as typeof goodManifest & { pages: (Page & Record<string, unknown>)[] };
    m.pages[0]!.icon = "chart-line";
    const r = validateManifest(m);
    expect(r.ok).toBe(true);
    expect(r.manifest!.pages[0]!.icon).toBe("chart-line");
  });

  it("rejects a page that declares both islands and groups", () => {
    const m = structuredClone(groupedManifest) as typeof groupedManifest & { pages: Record<string, unknown>[] };
    m.pages[0]!.islands = [{ type: "note.card", markdown: "x" }];
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "overview" && /both/.test(e.message))).toBe(true);
  });

  it("rejects a page that declares neither islands nor groups", () => {
    const m = structuredClone(goodManifest) as typeof goodManifest & { pages: Record<string, unknown>[] };
    delete m.pages[0]!.islands;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "overview" && /islands.+groups|groups.+islands/.test(e.message))).toBe(true);
  });

  it("rejects duplicate page ids", () => {
    const m = structuredClone(goodManifest);
    m.pages.push(structuredClone(goodManifest.pages[0]!));
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /duplicate page id/.test(e.message))).toBe(true);
  });

  it("rejects duplicate group ids within a page", () => {
    const m = structuredClone(groupedManifest);
    m.pages[0]!.groups[1]!.id = "headline";
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /duplicate group id/.test(e.message))).toBe(true);
  });

  it("accepts a manifest with a valid top-level icon", () => {
    const m = structuredClone(goodManifest) as typeof goodManifest & Record<string, unknown>;
    m.icon = "wallet";
    const r = validateManifest(m);
    expect(r.ok).toBe(true);
    expect(r.manifest!.icon).toBe("wallet");
  });

  it("rejects an invalid top-level icon name", () => {
    const m = structuredClone(goodManifest) as typeof goodManifest & Record<string, unknown>;
    m.icon = "rocket";
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "-" && /icon: must be one of/.test(e.message))).toBe(true);
  });

  it("rejects an invalid icon name", () => {
    const m = structuredClone(goodManifest) as typeof goodManifest & { pages: Record<string, unknown>[] };
    m.pages[0]!.icon = "rocket";
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "overview" && /icon/.test(e.message))).toBe(true);
  });

  it("names an invalid island in the second group with its flat running index", () => {
    const m = structuredClone(groupedManifest);
    delete (m.pages[0]!.groups[1]!.islands[0] as Record<string, unknown>).y;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.type === "timeseries.line");
    expect(err).toBeDefined();
    expect(err!.page).toBe("overview");
    expect(err!.index).toBe(2); // runs across the two islands in group 1
  });
});

describe("layout.row", () => {
  const rowManifest = {
    version: 1,
    title: "T",
    datasets: { d: { source: "data/d.csv" } },
    pages: [
      {
        id: "p",
        islands: [
          { type: "metric.kpi", dataset: "d", value: "v" },
          {
            type: "layout.row",
            id: "kpis",
            islands: [
              { type: "metric.kpi", dataset: "d", value: "v2" },
              { type: "metric.kpi", dataset: "d", value: "v3" },
            ],
          },
          { type: "metric.kpi", dataset: "d", value: "v4" },
        ],
      },
    ],
  };

  it("parses a manifest with a layout.row and normalizes child defaults", () => {
    const r = validateManifest(rowManifest);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    const page = r.manifest!.pages[0]!;
    const row = page.islands![1] as { type: string; islands: { compareTo: string }[] };
    expect(row.type).toBe("layout.row");
    expect(row.islands[0]!.compareTo).toBe("none");
  });

  it("flat indices run across rows and loose islands in declared order", () => {
    const r = validateManifest(rowManifest);
    const flat = flattenPageIslands(r.manifest!.pages[0]!);
    expect(flat.map((f) => f.index)).toEqual([0, 1, 2, 3]);
    expect(flat[0]!.rowKey).toBeUndefined();
    expect(flat[1]!.rowKey).toBe("kpis");
    expect(flat[2]!.rowKey).toBe("kpis");
    expect(flat[3]!.rowKey).toBeUndefined();
  });

  it("anonymous rows get a stable generated rowKey", () => {
    const m = {
      version: 1,
      title: "T",
      datasets: {},
      pages: [
        {
          id: "p",
          islands: [
            { type: "layout.row", islands: [{ type: "note.card", markdown: "x" }] },
            { type: "layout.row", islands: [{ type: "note.card", markdown: "y" }] },
          ],
        },
      ],
    };
    const r = validateManifest(m);
    const flat = flattenPageIslands(r.manifest!.pages[0]!);
    expect(flat[0]!.rowKey).toBe("row-0");
    expect(flat[1]!.rowKey).toBe("row-1");
  });

  it("custom child inside a row lands in custom with the right flat index", () => {
    const m = {
      version: 1,
      title: "T",
      datasets: {},
      pages: [
        {
          id: "p",
          islands: [
            { type: "note.card", markdown: "x" },
            { type: "layout.row", id: "r", islands: [{ type: "my.widget", dataset: "d" }] },
          ],
        },
      ],
    };
    const r = validateManifest(m as never);
    expect(r.ok).toBe(true);
    expect(r.custom).toHaveLength(1);
    expect(r.custom[0]!.type).toBe("my.widget");
    expect(r.custom[0]!.index).toBe(1);
  });

  it("rejects a nested layout.row", () => {
    const m = {
      version: 1,
      title: "T",
      datasets: {},
      pages: [
        {
          id: "p",
          islands: [
            {
              type: "layout.row",
              islands: [{ type: "layout.row", islands: [{ type: "note.card", markdown: "x" }] }],
            },
          ],
        },
      ],
    };
    const r = validateManifest(m as never);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.type === "layout.row" && /cannot nest/.test(e.message))).toBe(true);
  });

  it("rejects an empty layout.row", () => {
    const m = {
      version: 1,
      title: "T",
      datasets: {},
      pages: [
        {
          id: "p",
          islands: [{ type: "layout.row", islands: [] }],
        },
      ],
    };
    const r = validateManifest(m as never);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.type === "layout.row" && /needs at least one/.test(e.message))).toBe(true);
  });

  it("rejects a child span below its type minimum, reporting the correct flat index", () => {
    const m = {
      version: 1,
      title: "T",
      datasets: { d: { source: "data/d.csv" } },
      pages: [
        {
          id: "p",
          islands: [
            { type: "note.card", markdown: "x" },
            {
              type: "layout.row",
              islands: [{ type: "timeseries.line", dataset: "d", x: "month", y: "v", span: 1 }],
            },
          ],
        },
      ],
    };
    const r = validateManifest(m as never);
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.field === "span");
    expect(err).toBeDefined();
    expect(err!.index).toBe(1);
    expect(err!.type).toBe("timeseries.line");
  });
});

describe("rich feed rows + drilldown", () => {
  it("a drilldown island cannot itself carry a drilldown (the nested drilldown is dropped, not honored)", () => {
    const r = BUILTIN_ISLAND_SCHEMAS["timeline.feed"].safeParse({
      type: "timeline.feed",
      dataset: "meals",
      ts: "at",
      titleField: "name",
      drilldown: {
        match: { meal_id: "id" },
        island: {
          type: "table.grid",
          dataset: "components",
          columns: [{ field: "name" }],
          drilldown: { match: { x: "y" }, island: { type: "note.card", markdown: "x" } },
        },
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const island = (r.data as { drilldown: { island: Record<string, unknown> } }).drilldown.island;
    expect(island.drilldown).toBeUndefined();
  });

  it("names the empty-match drilldown error with page/index/type", () => {
    const m = structuredClone(goodManifest) as Record<string, unknown>;
    (m.pages as { id: string; islands: unknown[] }[])[0]!.islands = [
      {
        type: "timeline.feed",
        dataset: "net_worth",
        ts: "at",
        titleField: "name",
        drilldown: { match: {}, island: { type: "note.card", markdown: "x" } },
      },
    ];
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.field === "drilldown.match");
    expect(err).toBeDefined();
    expect(err!.type).toBe("timeline.feed");
    expect(err!.page).toBe("overview");
    expect(err!.index).toBe(0);
    expect(err!.message).toBe("drilldown needs at least one match column");
  });

  it("emits feed + drilldown properties in the JSON Schema with no leaked $refs", () => {
    for (const type of ["timeline.feed", "table.grid"] as const) {
      const schema = jsonSchemaFor(type);
      const joined = JSON.stringify(schema);
      expect(joined).toContain("drilldown");
      const refs: string[] = [];
      collectKeys(schema, "$ref", refs);
      expect(refs, type).toHaveLength(0);
    }
    const feed = JSON.stringify(jsonSchemaFor("timeline.feed"));
    expect(feed).toContain("highlight");
    expect(feed).toContain("stats");
    expect(feed).toContain("footer");
  });
});

// --- Actions: declared, typed data writes ---------------------------------------

const actionManifest = {
  version: 1,
  title: "Finance Overview",
  datasets: {
    net_worth: { source: "data/net_worth.csv" },
    notes: { source: "content/notes.json" },
    rollup: { sql: "models/rollup.sql" },
    strategy: { source: "content/strategy.md" },
  },
  pages: [{ id: "overview", islands: [{ type: "note.card", markdown: "x" }] }],
  actions: {
    log_entry: {
      dataset: "net_worth",
      mode: "insert",
      description: "Append a monthly net worth row",
      fields: { net_worth_eur: { type: "number", min: 0 }, note: { type: "string" } },
    },
  },
};

describe("validateManifest — actions", () => {
  it("accepts a valid action and carries it into the normalized manifest", () => {
    const r = validateManifest(actionManifest);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.manifest!.actions!.log_entry!.dataset).toBe("net_worth");
    expect(r.manifest!.actions!.log_entry!.mode).toBe("insert");
    expect(r.manifest!.actions!.log_entry!.fields!.net_worth_eur!.type).toBe("number");
  });

  it("leaves actions undefined when the manifest declares none", () => {
    const r = validateManifest(goodManifest);
    expect(r.ok).toBe(true);
    expect(r.manifest!.actions).toBeUndefined();
  });

  it("accepts a JSON-source action dataset", () => {
    const m = structuredClone(actionManifest);
    m.actions.log_entry.dataset = "notes";
    const r = validateManifest(m);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  });

  it("rejects an action bound to an unknown dataset", () => {
    const m = structuredClone(actionManifest);
    m.actions.log_entry.dataset = "ghost";
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => /unknown dataset/.test(e.message));
    expect(err).toBeDefined();
    expect(err!.page).toBe("-");
  });

  it("rejects an action bound to a sql (derived) dataset", () => {
    const m = structuredClone(actionManifest);
    m.actions.log_entry.dataset = "rollup";
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "-" && /sql transform|derived/.test(e.message))).toBe(true);
  });

  it("accepts an action writing to a sqlite dataset", () => {
    const m = structuredClone(actionManifest) as Record<string, unknown> & typeof actionManifest;
    (m.datasets as Record<string, unknown>).library = { source: "data/library.sqlite", table: "tracks" };
    m.actions.log_entry.dataset = "library";
    const r = validateManifest(m);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  });

  it("rejects an action whose source extension is not writable", () => {
    const m = structuredClone(actionManifest);
    m.actions.log_entry.dataset = "strategy";
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "-" && /not writable/.test(e.message))).toBe(true);
  });

  it("rejects a malformed action spec", () => {
    const m = structuredClone(actionManifest) as typeof actionManifest & { actions: Record<string, Record<string, unknown>> };
    m.actions.log_entry.mode = "update";
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "-" && /actions\.log_entry/.test(e.message))).toBe(true);
  });
});

// --- Connectors: vendored integrations -------------------------------------------

const connectorManifest = {
  version: 1,
  title: "Health",
  datasets: {
    recovery: { source: "data/recovery.csv" },
    sleep: { source: "data/sleep.jsonl" },
    rollup: { sql: "models/rollup.sql" },
    strategy: { source: "content/strategy.md" },
  },
  pages: [{ id: "overview", islands: [{ type: "note.card", markdown: "x" }] }],
  connectors: {
    whoop: {
      module: "connectors/whoop",
      datasets: { recovery: "recovery", sleep: "sleep" },
      schedule: "6h",
      config: { unit: "metric" },
      description: "Whoop recovery + sleep",
    },
  },
};

describe("validateManifest — connectors", () => {
  it("accepts a valid connector and carries it into the normalized manifest", () => {
    const r = validateManifest(connectorManifest);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.manifest!.connectors!.whoop!.module).toBe("connectors/whoop");
    expect(r.manifest!.connectors!.whoop!.datasets.recovery).toBe("recovery");
    expect(r.manifest!.connectors!.whoop!.schedule).toBe("6h");
  });

  it("leaves connectors undefined when the manifest declares none", () => {
    const r = validateManifest(goodManifest);
    expect(r.ok).toBe(true);
    expect(r.manifest!.connectors).toBeUndefined();
  });

  it("rejects a connector output bound to an unknown dataset", () => {
    const m = structuredClone(connectorManifest);
    m.connectors.whoop.datasets.recovery = "ghost";
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => /unknown dataset 'ghost'/.test(e.message));
    expect(err).toBeDefined();
    expect(err!.page).toBe("-");
  });

  it("rejects a connector output bound to a sql (derived) dataset", () => {
    const m = structuredClone(connectorManifest);
    m.connectors.whoop.datasets.recovery = "rollup";
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "-" && /sql transform|derived/.test(e.message))).toBe(true);
  });

  it("accepts a connector output bound to a sqlite dataset", () => {
    const m = structuredClone(connectorManifest) as Record<string, unknown> & typeof connectorManifest;
    (m.datasets as Record<string, unknown>).library = { source: "data/library.db", table: "tracks" };
    m.connectors.whoop.datasets.recovery = "library";
    const r = validateManifest(m);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  });

  it("rejects a connector output whose source extension is not writable", () => {
    const m = structuredClone(connectorManifest);
    m.connectors.whoop.datasets.recovery = "strategy";
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "-" && /not writable/.test(e.message))).toBe(true);
  });

  it("rejects a malformed connector spec", () => {
    const m = structuredClone(connectorManifest) as typeof connectorManifest & { connectors: Record<string, Record<string, unknown>> };
    delete m.connectors.whoop.module;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "-" && /connectors\.whoop/.test(e.message))).toBe(true);
  });
});

// --- Per-island schema coverage: a valid case and an invalid case each ----------

const validIslands: Record<IslandType, Record<string, unknown>> = {
  "metric.kpi": { type: "metric.kpi", dataset: "d", value: "v", compareTo: "prev", format: "eur" },
  "metric.scorecard": { type: "metric.scorecard", dataset: "d", stats: [{ value: "mrr", label: "MRR", format: "eur", compareTo: "prev" }, { value: "users", format: "int" }], columns: 4 },
  "timeseries.line": { type: "timeseries.line", dataset: "d", x: "month", y: ["a", "b"], options: { area: true, goalField: "target" } },
  "category.bar": { type: "category.bar", dataset: "d", x: "cat", y: "amount", group: "region", stacked: true },
  "breakdown.treemap": { type: "breakdown.treemap", dataset: "d", label: "name", value: "size", parent: "group" },
  "category.pie": { type: "category.pie", dataset: "d", label: "cat", value: "amount", donut: true, format: "eur" },
  "correlation.scatter": { type: "correlation.scatter", dataset: "d", x: "spend", y: "conv", series: "channel", size: "customers", label: "channel", format: "int", xFormat: "eur" },
  "distribution.heatmap": { type: "distribution.heatmap", dataset: "d", x: "hour", y: "day", value: "count", format: "int" },
  "activity.calendar": { type: "activity.calendar", dataset: "d", date: "day", value: "count", format: "int" },
  "funnel.steps": { type: "funnel.steps", dataset: "d", label: "stage", value: "count", sort: "descending", format: "int" },
  "compare.radar": { type: "compare.radar", dataset: "d", metrics: ["perf", "price", "design"], series: "product", max: 100, format: "int" },
  "map.choropleth": { type: "map.choropleth", dataset: "d", region: "country", value: "revenue", format: "eur" },
  "table.grid": {
    type: "table.grid",
    dataset: "d",
    columns: [{ field: "f", label: "F", format: "int" }],
    drilldown: { island: { type: "table.grid", dataset: "components", columns: [{ field: "name" }] }, match: { parent_id: "f" } },
  },
  "timeline.feed": {
    type: "timeline.feed",
    dataset: "d",
    ts: "at",
    titleField: "title",
    detail: "body",
    kind: "release",
    highlight: { field: "kcal", unit: "kcal" },
    stats: [{ field: "protein_g", label: "P", unit: "g" }],
    footer: [{ field: "tag", label: "Tag", pill: true }],
    drilldown: { island: { type: "table.grid", dataset: "components", columns: [{ field: "name" }] }, match: { meal_id: "id" } },
  },
  "gauge.rings": { type: "gauge.rings", dataset: "d", rings: [{ value: "protein_g", max: "protein_goal_g", label: "Protein" }, { value: "carb_g", max: 250, color: "#0a84ff" }] },
  "gauge.goal": { type: "gauge.goal", dataset: "d", value: "kcal", goal: { min: "kcal_low", max: "kcal_high" }, label: "kcal", format: "int" },
  "gauge.meter": { type: "gauge.meter", dataset: "d", meters: [{ value: "used_gb", max: "quota_gb", label: "Storage" }, { value: "req", max: 1000, color: "#0a84ff" }] },
  "search.box": { type: "search.box", dataset: "d", fields: ["name", "artist"], titleField: "name", detail: "artist", placeholder: "Search tracks…", limit: 5 },
  "note.card": { type: "note.card", markdown: "# hello" },
  "source.doc": { type: "source.doc", file: "doc.pdf", kind: "pdf" },
};

const invalidIslands: Record<IslandType, Record<string, unknown>> = {
  "metric.kpi": { type: "metric.kpi", dataset: "d" },
  "metric.scorecard": { type: "metric.scorecard", dataset: "d", stats: [] },
  "timeseries.line": { type: "timeseries.line", dataset: "d", x: "month" },
  "category.bar": { type: "category.bar", dataset: "d", x: "cat" },
  "breakdown.treemap": { type: "breakdown.treemap", dataset: "d", label: "name" },
  "category.pie": { type: "category.pie", dataset: "d", label: "cat" },
  "correlation.scatter": { type: "correlation.scatter", dataset: "d", x: "spend" },
  "distribution.heatmap": { type: "distribution.heatmap", dataset: "d", x: "hour", y: "day" },
  "activity.calendar": { type: "activity.calendar", dataset: "d", date: "day" },
  "funnel.steps": { type: "funnel.steps", dataset: "d", label: "stage" },
  "compare.radar": { type: "compare.radar", dataset: "d", metrics: [] },
  "map.choropleth": { type: "map.choropleth", dataset: "d", region: "country" },
  "table.grid": { type: "table.grid", columns: [{ field: "f", format: "usd" }] },
  "timeline.feed": { type: "timeline.feed", dataset: "d", ts: "at", titleField: "t", stats: [{ label: "P" }] },
  "gauge.rings": { type: "gauge.rings", dataset: "d", rings: [] },
  "gauge.goal": { type: "gauge.goal", dataset: "d", goal: { max: "kcal_high" } },
  "gauge.meter": { type: "gauge.meter", dataset: "d", meters: [] },
  "search.box": { type: "search.box", dataset: "d", fields: [], titleField: "name" },
  "note.card": { type: "note.card" },
  "source.doc": { type: "source.doc", kind: "spreadsheet" },
};

describe("per-island schemas", () => {
  for (const type of BUILTIN_ISLAND_TYPES) {
    it(`accepts a valid ${type}`, () => {
      const r = BUILTIN_ISLAND_SCHEMAS[type].safeParse(validIslands[type]);
      expect(r.success, JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it(`rejects an invalid ${type}`, () => {
      const r = BUILTIN_ISLAND_SCHEMAS[type].safeParse(invalidIslands[type]);
      expect(r.success).toBe(false);
    });
  }
});

describe("gauge.rings ring direction", () => {
  it("defaults a ring's direction to atLeast", () => {
    const r = BUILTIN_ISLAND_SCHEMAS["gauge.rings"].safeParse({
      type: "gauge.rings",
      dataset: "d",
      rings: [{ value: "protein_g", max: "protein_goal_g" }],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.rings[0].direction).toBe("atLeast");
  });

  it("accepts an atMost budget ring", () => {
    const r = BUILTIN_ISLAND_SCHEMAS["gauge.rings"].safeParse({
      type: "gauge.rings",
      dataset: "d",
      rings: [{ value: "sat_fat_g", max: "sat_fat_limit_g", direction: "atMost" }],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.rings[0].direction).toBe("atMost");
  });

  it("rejects more than four rings, naming the island", () => {
    const m = structuredClone(goodManifest) as Record<string, unknown>;
    const rings = Array.from({ length: 5 }, (_, i) => ({ value: `v${i}`, max: 100 }));
    (m.pages as { id: string; islands: unknown[] }[])[0]!.islands = [
      { type: "gauge.rings", dataset: "net_worth", rings },
    ];
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.type === "gauge.rings");
    expect(err).toBeDefined();
    expect(err!.page).toBe("overview");
    expect(err!.field).toBe("rings");
  });
});

describe("gauge.goal bounds", () => {
  const goalManifest = (goal: unknown) => {
    const m = structuredClone(goodManifest) as Record<string, unknown>;
    (m.pages as { id: string; islands: unknown[] }[])[0]!.islands = [
      { type: "gauge.goal", dataset: "net_worth", value: "net_worth_eur", goal },
    ];
    return m;
  };

  it("accepts a single bound", () => {
    expect(validateManifest(goalManifest({ max: "target" })).ok).toBe(true);
    expect(validateManifest(goalManifest({ min: 100 })).ok).toBe(true);
  });

  it("accepts a target band", () => {
    expect(validateManifest(goalManifest({ min: "low", max: "high" })).ok).toBe(true);
  });

  it("rejects a goal with neither bound, naming the island", () => {
    const r = validateManifest(goalManifest({}));
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.type === "gauge.goal");
    expect(err).toBeDefined();
    expect(err!.page).toBe("overview");
    expect(err!.index).toBe(0);
    expect(err!.field).toBe("goal");
  });
});

describe("validateManifest — per-island minimum span", () => {
  it("rejects a span below the type minimum, naming page/index/type", () => {
    const m = structuredClone(goodManifest);
    (m.pages[0]!.islands[1] as Record<string, unknown>).span = 1;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.field === "span");
    expect(err).toBeDefined();
    expect(err!.type).toBe("timeseries.line");
    expect(err!.page).toBe("overview");
    expect(err!.index).toBe(1);
    expect(err!.message).toBe("span 1 is below the minimum 4 for timeseries.line");
  });

  it("accepts a span at the type minimum", () => {
    const m = structuredClone(goodManifest);
    (m.pages[0]!.islands[0] as Record<string, unknown>).span = 2; // metric.kpi min is 2
    const r = validateManifest(m);
    expect(r.ok).toBe(true);
  });
});

// --- JSON Schema round-trip -----------------------------------------------------

function collectKeys(node: unknown, key: string, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, key, out);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [k, v] of Object.entries(node)) {
    if (k === key) out.push(JSON.stringify(v));
    collectKeys(v, key, out);
  }
}

describe("JSON Schema emission", () => {
  it("emits an object JSON Schema for every built-in island type", () => {
    for (const type of BUILTIN_ISLAND_TYPES) {
      const schema = jsonSchemaFor(type) as Record<string, unknown>;
      expect(schema).toBeTypeOf("object");
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
    }
  });

  it("emits a JSON Schema for the whole manifest", () => {
    const schema = manifestJsonSchema() as Record<string, unknown>;
    expect(schema).toBeTypeOf("object");
    expect(schema.properties).toBeDefined();
  });

  it("encodes required dataset/value on metric.kpi", () => {
    const schema = jsonSchemaFor("metric.kpi") as { required?: string[] };
    expect(schema.required).toContain("dataset");
    expect(schema.required).toContain("value");
  });

  it("encodes required x/y on timeseries.line", () => {
    const schema = jsonSchemaFor("timeseries.line") as { required?: string[] };
    expect(schema.required).toContain("x");
    expect(schema.required).toContain("y");
  });

  it("encodes the format enum values where format appears", () => {
    const enums: string[] = [];
    collectKeys(jsonSchemaFor("metric.kpi"), "enum", enums);
    expect(enums).toContain(JSON.stringify(["eur", "kg", "int", "pct", "date", "datetime", "time"]));
  });

  it("encodes the source.doc kind enum", () => {
    const enums: string[] = [];
    collectKeys(jsonSchemaFor("source.doc"), "enum", enums);
    expect(enums).toContain(JSON.stringify(["pdf", "markdown", "image", "link"]));
  });

  it("emits a clean JSON Schema with no leaked $ref pointers for any island type", () => {
    for (const type of BUILTIN_ISLAND_TYPES) {
      const refs: string[] = [];
      collectKeys(jsonSchemaFor(type), "$ref", refs);
      expect(refs, type).toHaveLength(0);
    }
  });

  it("encodes the manifest version literal and required top-level fields", () => {
    const schema = manifestJsonSchema() as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toContain("version");
    expect(schema.required).toContain("title");
    expect(schema.required).toContain("datasets");
    expect(schema.required).toContain("pages");
    const consts: string[] = [];
    collectKeys(schema.properties?.version, "const", consts);
    expect(consts).toContain("1");
  });

  it("encodes the page groups + icon shape with no leaked $refs", () => {
    const schema = manifestJsonSchema();
    const props: string[] = [];
    collectKeys(schema, "properties", props);
    const joined = JSON.stringify(schema);
    expect(joined).toContain("groups");
    expect(joined).toContain("icon");
    const refs: string[] = [];
    collectKeys(schema, "$ref", refs);
    expect(refs).toHaveLength(0);
  });

  it("encodes the curated page icon enum", () => {
    const enums: string[] = [];
    collectKeys(manifestJsonSchema(), "enum", enums);
    expect(enums.some((e) => e.includes("wallet") && e.includes("chart-line"))).toBe(true);
  });

  it("encodes the actions shape with no leaked $refs", () => {
    const schema = manifestJsonSchema();
    expect(JSON.stringify(schema)).toContain("actions");
    const refs: string[] = [];
    collectKeys(schema, "$ref", refs);
    expect(refs).toHaveLength(0);
  });
});

const withFilters = (filters: unknown) => ({
  version: 1,
  title: "T",
  datasets: { nw: { source: "data/nw.csv" }, tx: { source: "data/tx.csv" } },
  pages: [
    {
      id: "overview",
      filters,
      islands: [{ type: "metric.kpi", dataset: "nw", value: "v" }],
    },
  ],
});

describe("page filters", () => {
  it("accepts a daterange filter and normalizes it onto the page", () => {
    const r = validateManifest(withFilters([{ id: "period", type: "daterange", label: "Period", bind: { nw: "month", tx: "ts" } }]));
    expect(r.ok).toBe(true);
    const filter = r.manifest!.pages[0]!.filters![0]!;
    expect(filter.id).toBe("period");
    expect(filter.bind).toEqual({ nw: "month", tx: "ts" });
  });

  it("round-trips the filter shape into the JSON Schema with no leaked $refs", () => {
    const schema = manifestJsonSchema();
    const joined = JSON.stringify(schema);
    expect(joined).toContain("filters");
    expect(joined).toContain("daterange");
    const refs: string[] = [];
    collectKeys(schema, "$ref", refs);
    expect(refs).toHaveLength(0);
  });

  it("rejects duplicate filter ids on a page", () => {
    const r = validateManifest(
      withFilters([
        { id: "period", type: "daterange", bind: { nw: "month" } },
        { id: "period", type: "daterange", bind: { tx: "ts" } },
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes("duplicate filter id 'period'"))).toBe(true);
  });

  it("rejects a bind referencing an undeclared dataset", () => {
    const r = validateManifest(withFilters([{ id: "period", type: "daterange", bind: { ghost: "month" } }]));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.page === "overview" && e.message.includes("unknown dataset 'ghost'"))).toBe(true);
  });
});
