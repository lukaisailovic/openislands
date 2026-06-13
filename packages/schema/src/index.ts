/**
 * @openislands/schema — the single source of truth.
 *
 * One Zod schema per concept gives us three outputs from one definition:
 *   1. runtime validation (`validateManifest`)
 *   2. TypeScript types (`Manifest`, `Island`, ...)
 *   3. published JSON Schema (`jsonSchemaFor`, `manifestJsonSchema`) for editor
 *      autocomplete and agent grounding.
 *
 * The manifest schema is deliberately *structural only* — no transforms, no
 * refinements that can't be represented in JSON Schema. Data transforms live in
 * the SQL/compiler layer, not here, so the published JSON Schema stays lossless.
 */
import { z } from "zod";

/** A layout span in a 12-column grid. */
const Span = z.number().int().min(1).max(12).optional();

/** The display formats a numeric value can be rendered in. */
export const ValueFormat = z.enum(["eur", "kg", "int", "pct", "date", "datetime", "time"]);
export type ValueFormat = z.infer<typeof ValueFormat>;

const baseFields = {
  id: z.string().optional(),
  title: z.string().optional(),
  span: Span,
};

// --- The nine built-in islands --------------------------------------------------
// Each is a stable, code-backed component with a typed config. An agent moves and
// configures instances; it never writes the rendering code.

export const MetricKpi = z.object({
  type: z.literal("metric.kpi"),
  ...baseFields,
  dataset: z.string(),
  value: z.string().describe("field holding the headline value"),
  compareTo: z.string().default("none").describe("'prev', 'none', or a field name"),
  target: z.string().optional().describe("field holding a target to compare against"),
  unit: z.string().optional(),
  format: ValueFormat.optional(),
  color: z.string().optional().describe("6-digit hex color (e.g. \"#22C55E\") for the sparkline, overriding the default palette"),
}).describe("A single headline number, optionally with a delta vs the previous row or a target — use for at-a-glance KPIs.");

export const TimeseriesLine = z.object({
  type: z.literal("timeseries.line"),
  ...baseFields,
  dataset: z.string(),
  x: z.string().describe("date/time field"),
  y: z.union([z.string(), z.array(z.string())]).describe("numeric field(s)"),
  series: z.string().optional().describe("field to split series by"),
  colors: z
    .array(z.string())
    .optional()
    .describe("CSS colors per y field (or per series value, in first-seen order), overriding the default palette"),
  options: z
    .object({
      area: z.boolean().default(false),
      goalField: z.string().optional(),
      seriesPicker: z
        .boolean()
        .optional()
        .describe("force or disable the series picker; defaults to automatic when a series field yields many values"),
    })
    .optional(),
}).describe("A line chart over time — use for trends; supports multiple y fields, a series split, and a goal line.");

export const CategoryBar = z.object({
  type: z.literal("category.bar"),
  ...baseFields,
  dataset: z.string(),
  x: z.string().describe("category field"),
  y: z.string().describe("numeric field"),
  group: z.string().optional(),
  stacked: z.boolean().default(false),
  colors: z
    .array(z.string())
    .optional()
    .describe("CSS colors per series (group value or y field), overriding the default palette"),
}).describe("A bar chart across categories — use to compare discrete groups; supports grouped or stacked bars.");

export const BreakdownTreemap = z.object({
  type: z.literal("breakdown.treemap"),
  ...baseFields,
  dataset: z.string(),
  label: z.string(),
  value: z.string(),
  parent: z.string().optional().describe("field for hierarchy parent"),
  colors: z
    .array(z.string())
    .optional()
    .describe("CSS colors cycled across top-level nodes, overriding the default palette"),
}).describe("A treemap of part-to-whole composition — use to show how a total splits across (optionally hierarchical) parts.");

export const FunnelSteps = z.object({
  type: z.literal("funnel.steps"),
  ...baseFields,
  dataset: z.string(),
  label: z.string().describe("stage-name field"),
  value: z.string().describe("numeric field — the count at each stage"),
  sort: z
    .enum(["none", "ascending", "descending"])
    .default("none")
    .describe("funnel ordering; 'none' keeps the declared row order"),
  colors: z
    .array(z.string())
    .optional()
    .describe("CSS colors per stage, overriding the default palette"),
  format: ValueFormat.optional(),
}).describe("A funnel of sequential stages — use for conversion or drop-off; each stage's width is its share, ordered by the rows unless sort is set.");

export const ActivityCalendar = z.object({
  type: z.literal("activity.calendar"),
  ...baseFields,
  dataset: z.string(),
  date: z.string().describe("date field — any parseable date or timestamp"),
  value: z.string().describe("numeric field mapped to the day's color intensity"),
  colors: z
    .array(z.string())
    .optional()
    .describe("gradient color stops, overriding the default"),
  format: ValueFormat.optional(),
}).describe("A calendar heatmap — use to show a daily value over weeks and months, GitHub-contributions style; rows on the same day sum.");

export const DistributionHeatmap = z.object({
  type: z.literal("distribution.heatmap"),
  ...baseFields,
  dataset: z.string(),
  x: z.string().describe("column-category field (x axis)"),
  y: z.string().describe("row-category field (y axis)"),
  value: z.string().describe("numeric field mapped to each cell's color"),
  colors: z
    .array(z.string())
    .optional()
    .describe("gradient color stops for the scale, overriding the default"),
  format: ValueFormat.optional(),
}).describe("A matrix heatmap — use to show one value across two categorical dimensions (x × y), shaded by a continuous color scale.");

export const CorrelationScatter = z.object({
  type: z.literal("correlation.scatter"),
  ...baseFields,
  dataset: z.string(),
  x: z.string().describe("numeric field for the x axis"),
  y: z.string().describe("numeric field for the y axis"),
  series: z.string().optional().describe("field splitting points into one colored series per distinct value"),
  size: z.string().optional().describe("numeric field driving bubble radius; omit for fixed-size dots"),
  label: z.string().optional().describe("field naming each point, shown in the tooltip"),
  colors: z
    .array(z.string())
    .optional()
    .describe("CSS colors per series, overriding the default palette"),
  format: ValueFormat.optional().describe("formats the y value (axis + tooltip)"),
  xFormat: ValueFormat.optional().describe("formats the x value (axis + tooltip)"),
}).describe("A scatter or bubble plot of two numeric fields — use to explore correlation; split into series by a field and size points by a third.");

export const CategoryPie = z.object({
  type: z.literal("category.pie"),
  ...baseFields,
  dataset: z.string(),
  label: z.string().describe("category field naming each slice"),
  value: z.string().describe("numeric field sizing each slice"),
  donut: z.boolean().default(false).describe("render with an inner radius (a donut hole)"),
  colors: z
    .array(z.string())
    .optional()
    .describe("CSS colors per slice (in descending-value order), overriding the default palette"),
  format: ValueFormat.optional(),
}).describe("A pie or donut chart of part-to-whole composition — use for one series' share across a handful of categories; set donut for a hole.");

export const DetailSpec = z.object({
  field: z.string(),
  label: z.string().optional(),
  format: ValueFormat.optional(),
});
export type DetailSpec = z.infer<typeof DetailSpec>;

const Details = z
  .array(DetailSpec)
  .optional()
  .describe("fields hidden from the row, revealed by clicking it");

export const GroupBy = z.object({
  field: z.string().describe("column whose value partitions rows into groups"),
  titleField: z.string().optional().describe("column providing the section title (read from the group's first row; defaults to the group value)"),
  subtitleField: z.string().optional().describe("column shown next to the title, e.g. a date"),
});
export type GroupBy = z.infer<typeof GroupBy>;

const ColumnSpec = DetailSpec.extend({
  status: z
    .object({
      low: z.string().optional(),
      high: z.string().optional(),
      signal: z.string().optional().describe("field whose numeric sign drives the cell tone"),
    })
    .optional()
    .describe("fields holding range bounds, for in/out-of-range status cells"),
});

export const StatSpec = z.object({
  field: z.string(),
  label: z.string().optional().describe("short label rendered before the value, e.g. \"P\""),
  format: ValueFormat.optional(),
  unit: z.string().optional().describe("small unit suffix, e.g. \"g\""),
  color: z.string().optional().describe("CSS color for the label; defaults to a built-in palette"),
});
export type StatSpec = z.infer<typeof StatSpec>;

export const HighlightSpec = z.object({
  field: z.string(),
  format: ValueFormat.optional(),
  unit: z.string().optional().describe("small unit suffix, e.g. \"kcal\""),
});
export type HighlightSpec = z.infer<typeof HighlightSpec>;

export const FooterItemSpec = z.object({
  field: z.string(),
  label: z.string().optional(),
  format: ValueFormat.optional(),
  unit: z.string().optional(),
  pill: z.boolean().optional().describe("render the value as a badge/pill"),
});
export type FooterItemSpec = z.infer<typeof FooterItemSpec>;

const TableGridBase = z.object({
  type: z.literal("table.grid"),
  ...baseFields,
  dataset: z.string(),
  columns: z.array(ColumnSpec).optional(),
  details: Details,
  groupBy: GroupBy.optional(),
  pageSize: z.number().int().positive().default(25),
  expand: z
    .boolean()
    .default(true)
    .describe("offer the see-all / expand dialog; false renders every row inline instead"),
}).describe("A paginated table of raw rows — use when exact values matter; supports column formats, click-to-open details, and collapsible groups.");

const TimelineFeedBase = z.object({
  type: z.literal("timeline.feed"),
  ...baseFields,
  dataset: z.string(),
  ts: z.string().describe("timestamp field"),
  titleField: z.string(),
  detail: z.string().optional(),
  kind: z.string().optional(),
  details: Details,
  groupBy: GroupBy.optional(),
  highlight: HighlightSpec.optional().describe("right-aligned emphasized value in the row header"),
  stats: z.array(StatSpec).optional().describe("labeled inline stats rendered under the title"),
  footer: z
    .array(FooterItemSpec)
    .optional()
    .describe("small meta line below the row; the row timestamp always leads it. Setting any of highlight/stats/footer switches the row from a single line to the rich layout"),
  expand: z
    .boolean()
    .default(true)
    .describe("offer the see-all dialog; false renders every row inline instead"),
}).describe("A reverse-chronological feed of events — use for logs and activity; supports detail dialogs and collapsible groups, and a rich row layout (header value, inline stats, meta footer) when highlight/stats/footer are set.");

const RingSpec = z.object({
  value: z.string().describe("field holding the ring's current value"),
  max: z.union([z.string(), z.number()]).describe("goal: a field name or a fixed number"),
  label: z.string().optional(),
  color: z.string().optional().describe("CSS color; defaults to a built-in palette"),
  direction: z
    .enum(["atLeast", "atMost"])
    .default("atLeast")
    .describe("atLeast fills toward a goal; atMost is a budget to stay under"),
});

export const GaugeRings = z.object({
  type: z.literal("gauge.rings"),
  ...baseFields,
  dataset: z.string(),
  rings: z
    .array(RingSpec)
    .min(1)
    .max(4)
    .describe("concentric rings, outermost first; reads the last row (max 4 for legible geometry)"),
}).describe("Up to four concentric progress rings read off the last row — use for tracking several goals or budgets at once.");

export const GaugeGoal = z.object({
  type: z.literal("gauge.goal"),
  ...baseFields,
  dataset: z.string(),
  value: z.string().describe("field holding the current value"),
  goal: z
    .object({
      min: z.union([z.string(), z.number()]).optional().describe("lower bound — column or number"),
      max: z.union([z.string(), z.number()]).optional().describe("upper bound — column or number"),
    })
    .describe("at least one bound; both = a target band"),
  label: z.string().optional(),
  unit: z.string().optional(),
  format: ValueFormat.optional(),
}).describe("A single ring comparing the last row's value to a goal or target band — use for one number with a defined good range.");

const MeterSpec = z.object({
  value: z.string().describe("field holding the meter's current value"),
  max: z.union([z.string(), z.number()]).describe("capacity: a field name or a fixed number"),
  label: z.string().optional(),
  color: z.string().optional().describe("CSS color; defaults to a built-in palette"),
});

export const GaugeMeter = z.object({
  type: z.literal("gauge.meter"),
  ...baseFields,
  dataset: z.string(),
  meters: z
    .array(MeterSpec)
    .min(1)
    .describe("horizontal usage bars, top to bottom; reads the last row"),
}).describe("One or more horizontal usage meters read off the last row — use for quota- or capacity-style values.");

export const SearchBox = z.object({
  type: z.literal("search.box"),
  ...baseFields,
  dataset: z.string(),
  fields: z.array(z.string()).min(1).describe("columns the query matches against"),
  titleField: z.string().describe("field each result shows"),
  detail: z.string().optional().describe("field shown as a secondary line under each result"),
  placeholder: z.string().optional(),
  limit: z.number().int().positive().default(10).describe("max visible results"),
}).describe("A search box over a dataset — typing matches rows case-insensitively across `fields`, results drop down as an autocomplete; selecting a result opens the row's details.");

export const NoteCard = z.object({
  type: z.literal("note.card"),
  ...baseFields,
  markdown: z.string(),
}).describe("A static markdown card with no data binding — use for commentary, instructions, or context between islands.");

export const SourceDoc = z.object({
  type: z.literal("source.doc"),
  ...baseFields,
  file: z.string().optional(),
  href: z.string().optional(),
  kind: z.enum(["pdf", "markdown", "image", "link"]).default("link"),
}).describe("An embedded file or external link (pdf, markdown, image, link) — use to surface source documents alongside the data.");

/**
 * The set of islands a drilldown may embed: every built-in except the two that
 * carry drilldowns themselves (those use their *base* shape here so a drilldown
 * island can't nest another drilldown — intentional, like layout.row not
 * nesting). Discriminated on `type` so the union stays `$ref`-free in JSON Schema.
 */
const DrilldownIsland = z.discriminatedUnion("type", [
  MetricKpi,
  TimeseriesLine,
  CategoryBar,
  BreakdownTreemap,
  CategoryPie,
  CorrelationScatter,
  DistributionHeatmap,
  ActivityCalendar,
  FunnelSteps,
  TableGridBase,
  TimelineFeedBase,
  GaugeRings,
  GaugeGoal,
  GaugeMeter,
  SearchBox,
  NoteCard,
  SourceDoc,
]);

export const Drilldown = z.object({
  island: DrilldownIsland,
  match: z.record(z.string(), z.string()).describe("drilldown-dataset column → clicked-row field whose value filters the embedded island's rows"),
}).describe("An island embedded in the row-details dialog, its rows filtered by matching drilldown-dataset columns to the clicked row's field values");
export type Drilldown = z.infer<typeof Drilldown>;

export const TableGrid = TableGridBase.extend({
  drilldown: Drilldown.optional().describe("an embedded island shown in a clicked row's details dialog, filtered to that row"),
});

export const TimelineFeed = TimelineFeedBase.extend({
  drilldown: Drilldown.optional().describe("an embedded island shown in a clicked row's details dialog, filtered to that row"),
});

/** The closed registry of built-in island types. */
export const BUILTIN_ISLAND_SCHEMAS = {
  "metric.kpi": MetricKpi,
  "timeseries.line": TimeseriesLine,
  "category.bar": CategoryBar,
  "breakdown.treemap": BreakdownTreemap,
  "distribution.heatmap": DistributionHeatmap,
  "activity.calendar": ActivityCalendar,
  "funnel.steps": FunnelSteps,
  "correlation.scatter": CorrelationScatter,
  "category.pie": CategoryPie,
  "table.grid": TableGrid,
  "timeline.feed": TimelineFeed,
  "gauge.rings": GaugeRings,
  "gauge.goal": GaugeGoal,
  "gauge.meter": GaugeMeter,
  "search.box": SearchBox,
  "note.card": NoteCard,
  "source.doc": SourceDoc,
} as const;

export type IslandType = keyof typeof BUILTIN_ISLAND_SCHEMAS;
export const BUILTIN_ISLAND_TYPES = Object.keys(BUILTIN_ISLAND_SCHEMAS) as IslandType[];

/**
 * The smallest grid span at which each island stays legible. An explicit `span`
 * below this is a named validation error; the runtime also floors spans
 * responsively so a tile never renders below its minimum usable width.
 */
export const ISLAND_MIN_SPAN: Record<IslandType, number> = {
  "metric.kpi": 2,
  "source.doc": 2,
  "note.card": 3,
  "gauge.rings": 4,
  "gauge.goal": 2,
  "gauge.meter": 3,
  "search.box": 3,
  "timeseries.line": 4,
  "category.bar": 4,
  "timeline.feed": 4,
  "breakdown.treemap": 4,
  "distribution.heatmap": 4,
  "activity.calendar": 6,
  "funnel.steps": 3,
  "correlation.scatter": 4,
  "category.pie": 3,
  "table.grid": 5,
};

export const BuiltinIsland = z.discriminatedUnion("type", [
  MetricKpi,
  TimeseriesLine,
  CategoryBar,
  BreakdownTreemap,
  CategoryPie,
  CorrelationScatter,
  DistributionHeatmap,
  ActivityCalendar,
  FunnelSteps,
  TableGrid,
  TimelineFeed,
  GaugeRings,
  GaugeGoal,
  GaugeMeter,
  SearchBox,
  NoteCard,
  SourceDoc,
]);
export type BuiltinIsland = z.infer<typeof BuiltinIsland>;

export const LayoutRow = z.object({
  type: z.literal("layout.row"),
  id: z.string().optional(),
  islands: z.array(BuiltinIsland).min(1),
}).describe("A full-width structural row holding other islands — use to force its children onto their own grid row.");
export type LayoutRow = z.infer<typeof LayoutRow>;

export const IslandEntry = z.union([BuiltinIsland, LayoutRow]);
export type IslandEntry = z.infer<typeof IslandEntry>;

// --- Manifest -------------------------------------------------------------------

export const DatasetSpec = z.object({
  source: z.string().optional().describe("path to a CSV / JSON / Parquet / SQLite file"),
  table: z.string().optional().describe("table within a .sqlite/.db source — required for sqlite, invalid elsewhere"),
  sql: z.string().optional().describe("path to a DuckDB SQL transform"),
  description: z.string().optional(),
});
export type DatasetSpec = z.infer<typeof DatasetSpec>;

export const SQLITE_SOURCE_EXTENSIONS = [".sqlite", ".db"];

/** A SQLite database source — read through DuckDB's sqlite extension, and written (insert/replace) through it too. */
export function isSqliteSource(source: string): boolean {
  return SQLITE_SOURCE_EXTENSIONS.includes(source.slice(source.lastIndexOf(".")).toLowerCase());
}

/** Curated Phosphor icon names a page may use in the sidebar. */
export const PAGE_ICONS = [
  "house",
  "chart-line",
  "chart-bar",
  "wallet",
  "coins",
  "heart",
  "pulse",
  "table",
  "files",
  "folder",
  "calendar",
  "list-bullets",
  "gear",
  "flask",
] as const;
export const PageIcon = z.enum(PAGE_ICONS);
export type PageIcon = z.infer<typeof PageIcon>;

/** The same curated set, used for an app's tile in the workspace app rail. */
export const APP_ICONS = PAGE_ICONS;

export const Group = z.object({
  id: z.string(),
  title: z.string().optional(),
  islands: z.array(IslandEntry),
});
export type Group = z.infer<typeof Group>;

/**
 * A page-level shared filter. v1 supports a date range; `bind` maps each
 * affected dataset to the column the range is applied to. Islands on the page
 * whose `dataset` appears in `bind` re-query when the filter changes; the rest
 * ignore it. The explicit dataset→column map keeps every binding validated
 * against the live data, like island bindings.
 */
export const PageFilter = z.object({
  id: z.string(),
  type: z.literal("daterange"),
  label: z.string().optional(),
  bind: z.record(z.string(), z.string()).describe("dataset → date column the range applies to"),
});
export type PageFilter = z.infer<typeof PageFilter>;

/**
 * A page holds either flat `islands` or tabbed `groups` — exactly one of the
 * two. The XOR is structural-only here (both optional) so the emitted JSON
 * Schema stays lossless; `validateManifest` enforces it.
 */
export const Page = z.object({
  id: z.string(),
  title: z.string().optional(),
  icon: PageIcon.optional(),
  layout: z.enum(["grid"]).default("grid"),
  filters: z.array(PageFilter).optional(),
  islands: z.array(IslandEntry).optional(),
  groups: z.array(Group).optional(),
});
export type Page = z.infer<typeof Page>;

export interface PageIsland {
  island: BuiltinIsland;
  /** flat index, running across groups in declared order — the `IslandError.index` space */
  index: number;
  groupId?: string;
  /** set on leaves declared inside a `layout.row` — the key consecutive leaves share so the renderer can group them into one full-width row */
  rowKey?: string;
}

/**
 * Normalize a page to its flat island list. The single source of island
 * indexing — compiler contract checks, runtime rendering, and SSE error keys
 * all walk this so they can never drift. `layout.row` entries are transparent
 * to indexing: a row carries no index, its leaf children take sequential flat
 * indices and share the row's `rowKey`.
 */
export function flattenPageIslands(page: Page): PageIsland[] {
  const flat: PageIsland[] = [];
  let rowCount = 0;

  const flattenIslands = (islands: IslandEntry[], groupId?: string): void => {
    for (const entry of islands) {
      if (entry.type === "layout.row") {
        const rowKey = entry.id ?? `row-${rowCount++}`;
        for (const child of entry.islands) {
          flat.push({ island: child, index: flat.length, groupId, rowKey });
        }
        continue;
      }
      flat.push({ island: entry, index: flat.length, groupId });
    }
  };

  if (page.groups) {
    for (const group of page.groups) flattenIslands(group.islands, group.id);
    return flat;
  }
  flattenIslands(page.islands ?? []);
  return flat;
}

// --- Actions: declared, typed data writes ----------------------------------------

/** Narrows or annotates one column of an action's derived row schema. */
export const FieldSpec = z.object({
  type: z.enum(["string", "number", "boolean", "date"]).optional(),
  enum: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().optional(),
});
export type FieldSpec = z.infer<typeof FieldSpec>;

/**
 * A manifest-declared write into a `source` dataset (never `sql` — derived
 * datasets aren't writable). `mode: "insert"` adds rows — an append for a
 * flat-file source (CSV / JSON(L)), an INSERT for a SQLite table — so the
 * storage backing the dataset never changes the contract. The row schema is
 * derived from the live data; `fields` only narrows it.
 */
export const ActionSpec = z.object({
  dataset: z.string(),
  mode: z.literal("insert"),
  description: z.string().optional(),
  fields: z.record(z.string(), FieldSpec).optional(),
});
export type ActionSpec = z.infer<typeof ActionSpec>;

/** Flat-file source formats a write can append rows to. */
const WRITABLE_FILE_EXTENSIONS = [".csv", ".json", ".ndjson", ".jsonl"];

/**
 * Every source format a write (action or connector) can target: a flat file it
 * appends to, or a SQLite table it inserts into. Derived `sql` views and
 * read-only formats (parquet, markdown) are excluded — they have no row sink.
 */
function isWritableSource(source: string): boolean {
  const ext = source.slice(source.lastIndexOf(".")).toLowerCase();
  return WRITABLE_FILE_EXTENSIONS.includes(ext) || SQLITE_SOURCE_EXTENSIONS.includes(ext);
}

/** The writable formats, for "not writable" error messages. */
const WRITABLE_SOURCE_EXTENSIONS = [...WRITABLE_FILE_EXTENSIONS, ...SQLITE_SOURCE_EXTENSIONS];

// --- Connectors: vendored integrations that sync provider data into datasets -----

/**
 * A manifest-declared connector instance. The integration code lives in the
 * user project at `<module>/index.ts` (dir name = connector name); each value in
 * `datasets` maps a connector output to a writable `source` dataset the sync
 * appends/replaces into. `config` is validated against the connector's own zod
 * schema at load time, not here.
 */
export const ConnectorSpec = z.object({
  module: z.string().describe("connector directory relative to project root, e.g. connectors/whoop"),
  datasets: z.record(z.string(), z.string()).describe("connector output name → manifest dataset name"),
  schedule: z.string().optional().describe("sync interval, overrides connector default; '<n>m|h|d' or ms-style"),
  config: z.record(z.string(), z.unknown()).optional().describe("free-form, validated against the connector's config schema"),
  description: z.string().optional(),
});
export type ConnectorSpec = z.infer<typeof ConnectorSpec>;

export const Manifest = z.object({
  version: z.literal(1),
  title: z.string(),
  icon: PageIcon.optional().describe("the app's tile icon in the workspace app rail"),
  datasets: z.record(z.string(), DatasetSpec),
  pages: z.array(Page),
  actions: z.record(z.string(), ActionSpec).optional(),
  connectors: z.record(z.string(), ConnectorSpec).optional(),
});
export type Manifest = z.infer<typeof Manifest>;

// --- JSON Schema emission (for editors + agent grounding) -----------------------

/** JSON Schema for a single island type. Agents use this to ground edits. */
export function jsonSchemaFor(type: IslandType): unknown {
  return z.toJSONSchema(BUILTIN_ISLAND_SCHEMAS[type]);
}

/** JSON Schema for the whole manifest. */
export function manifestJsonSchema(): unknown {
  return z.toJSONSchema(Manifest);
}

// --- Validation (fail loudly, name the island) ----------------------------------

export interface IslandError {
  page: string;
  index: number;
  type: string;
  message: string;
  /** the offending config path within the island, e.g. "y" or "options.goalField" */
  field?: string;
}

export interface ValidationResult {
  ok: boolean;
  manifest?: Manifest;
  /** structural / island errors, each naming exactly where it failed */
  errors: IslandError[];
  /** non-builtin island types — valid as custom islands, surfaced as info */
  custom: { page: string; index: number; type: string }[];
}

/**
 * Validate a manifest. Built-in islands are validated strictly against their
 * schema; unknown types are accepted as *custom* islands (the typed extension
 * point) and reported as info rather than failing the build. Every error names
 * the page, index, and type so failure is loud and specific.
 */
export function validateManifest(input: unknown): ValidationResult {
  const errors: IslandError[] = [];
  const custom: ValidationResult["custom"] = [];

  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: [{ page: "-", index: -1, type: "-", message: "manifest is not an object" }], custom };
  }

  const root = input as Record<string, unknown>;
  if (root.version !== 1) {
    errors.push({ page: "-", index: -1, type: "-", message: `unsupported manifest version: ${String(root.version)} (expected 1)` });
  }
  if (typeof root.title !== "string") {
    errors.push({ page: "-", index: -1, type: "-", message: "manifest.title must be a string" });
  }
  let appIcon: PageIcon | undefined;
  if (root.icon !== undefined) {
    const r = PageIcon.safeParse(root.icon);
    if (r.success) appIcon = r.data;
    else errors.push({ page: "-", index: -1, type: "-", message: `icon: must be one of ${PAGE_ICONS.join(", ")}` });
  }

  // datasets
  const datasets = (root.datasets ?? {}) as Record<string, unknown>;
  for (const [name, spec] of Object.entries(datasets)) {
    const r = DatasetSpec.safeParse(spec);
    if (!r.success) {
      errors.push({ page: "-", index: -1, type: "-", message: `datasets.${name}: ${r.error.issues[0]?.message ?? "invalid"}` });
    } else if (!r.data.source && !r.data.sql) {
      errors.push({ page: "-", index: -1, type: "-", message: `datasets.${name}: needs a 'source' file or a 'sql' transform` });
    } else if (r.data.source && isSqliteSource(r.data.source) && !r.data.table) {
      errors.push({ page: "-", index: -1, type: "-", message: `datasets.${name}: a sqlite source needs a 'table'` });
    } else if (r.data.table && (!r.data.source || !isSqliteSource(r.data.source))) {
      errors.push({ page: "-", index: -1, type: "-", message: `datasets.${name}: 'table' only applies to a .sqlite/.db source` });
    }
  }

  // actions
  const rootError = (message: string) => errors.push({ page: "-", index: -1, type: "-", message });
  const actions = root.actions === undefined ? undefined : (root.actions as Record<string, unknown>);
  for (const [name, spec] of Object.entries(actions ?? {})) {
    const r = ActionSpec.safeParse(spec);
    if (!r.success) {
      rootError(`actions.${name}: ${r.error.issues[0]?.message ?? "invalid"}`);
      continue;
    }
    const target = (datasets as Record<string, DatasetSpec | undefined>)[r.data.dataset];
    if (!target) {
      rootError(`actions.${name}: unknown dataset '${r.data.dataset}'`);
      continue;
    }
    if (target.sql) {
      rootError(`actions.${name}: dataset '${r.data.dataset}' is a sql transform — derived datasets are never writable`);
      continue;
    }
    const source = target.source ?? "";
    if (!isWritableSource(source)) {
      rootError(`actions.${name}: source '${source}' is not writable — insert supports ${WRITABLE_SOURCE_EXTENSIONS.join(", ")}`);
    }
  }

  // connectors
  const connectors = root.connectors === undefined ? undefined : (root.connectors as Record<string, unknown>);
  for (const [name, spec] of Object.entries(connectors ?? {})) {
    const r = ConnectorSpec.safeParse(spec);
    if (!r.success) {
      rootError(`connectors.${name}: ${r.error.issues[0]?.message ?? "invalid"}`);
      continue;
    }
    for (const [output, datasetName] of Object.entries(r.data.datasets)) {
      const target = (datasets as Record<string, DatasetSpec | undefined>)[datasetName];
      if (!target) {
        rootError(`connectors.${name}: output '${output}' targets unknown dataset '${datasetName}'`);
        continue;
      }
      if (target.sql) {
        rootError(`connectors.${name}: output '${output}' targets dataset '${datasetName}', a sql transform — derived datasets are never writable`);
        continue;
      }
      const source = target.source ?? "";
      if (!isWritableSource(source)) {
        rootError(`connectors.${name}: output '${output}' targets source '${source}', not writable — supports ${WRITABLE_SOURCE_EXTENSIONS.join(", ")}`);
      }
    }
  }

  const pages = Array.isArray(root.pages) ? (root.pages as Record<string, unknown>[]) : [];
  if (!Array.isArray(root.pages)) {
    errors.push({ page: "-", index: -1, type: "-", message: "manifest.pages must be an array" });
  }

  // Rebuild a normalized manifest as we validate: builtin islands get parsed
  // (defaults applied), custom islands pass through untouched. Island indices
  // run flat across a page's groups so errors share one index space.
  const validateIslands = (
    pageId: string,
    islands: Record<string, unknown>[],
    counter: { index: number },
  ): unknown[] => {
    const normalized: unknown[] = [];
    for (const island of islands) {
      const type = typeof island.type === "string" ? island.type : "(missing type)";

      if (type === "layout.row") {
        const rowId = typeof island.id === "string" ? island.id : undefined;
        const label = `layout.row${rowId ? ` id="${rowId}"` : ""}`;
        const children = island.islands;
        if (!Array.isArray(children) || children.length === 0) {
          errors.push({ page: pageId, index: -1, type: "layout.row", message: `${label}: needs at least one island` });
          normalized.push(island);
          continue;
        }
        const hasNested = (children as Record<string, unknown>[]).some((c) => c.type === "layout.row");
        if (hasNested) {
          errors.push({ page: pageId, index: -1, type: "layout.row", message: `${label}: cannot nest layout.row` });
          normalized.push(island);
          continue;
        }
        const normalizedChildren = validateIslands(pageId, children as Record<string, unknown>[], counter);
        normalized.push({ ...island, islands: normalizedChildren });
        continue;
      }

      const index = counter.index++;
      if (!(type in BUILTIN_ISLAND_SCHEMAS)) {
        custom.push({ page: pageId, index, type });
        normalized.push(island);
        continue;
      }
      const schema = BUILTIN_ISLAND_SCHEMAS[type as IslandType];
      const result = schema.safeParse(island);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const path = issue.path.join(".");
          errors.push({
            page: pageId,
            index,
            type,
            message: path ? `${path}: ${issue.message}` : issue.message,
            field: path || undefined,
          });
        }
        continue;
      }
      const minSpan = ISLAND_MIN_SPAN[type as IslandType];
      const span = (result.data as { span?: number }).span;
      if (typeof span === "number" && span < minSpan) {
        errors.push({
          page: pageId,
          index,
          type,
          message: `span ${span} is below the minimum ${minSpan} for ${type}`,
          field: "span",
        });
      }
      if (type === "gauge.goal") {
        const goal = (result.data as { goal?: { min?: unknown; max?: unknown } }).goal;
        if (!goal || (goal.min === undefined && goal.max === undefined)) {
          errors.push({
            page: pageId,
            index,
            type,
            message: "goal needs at least one of min or max",
            field: "goal",
          });
        }
      }
      const drilldown = (result.data as { drilldown?: { match?: Record<string, string> } }).drilldown;
      if (drilldown && Object.keys(drilldown.match ?? {}).length === 0) {
        errors.push({
          page: pageId,
          index,
          type,
          message: "drilldown needs at least one match column",
          field: "drilldown.match",
        });
      }
      normalized.push(result.data);
    }
    return normalized;
  };

  const normalizedPages: Page[] = [];
  const seenPageIds = new Set<string>();
  for (const page of pages) {
    const pageId = typeof page.id === "string" ? page.id : "(unnamed page)";
    const pageError = (message: string) => errors.push({ page: pageId, index: -1, type: "-", message });

    if (seenPageIds.has(pageId)) pageError(`duplicate page id '${pageId}'`);
    seenPageIds.add(pageId);

    let icon: PageIcon | undefined;
    if (page.icon !== undefined) {
      const r = PageIcon.safeParse(page.icon);
      if (r.success) icon = r.data;
      else pageError(`icon: must be one of ${PAGE_ICONS.join(", ")}`);
    }

    let filters: PageFilter[] | undefined;
    if (page.filters !== undefined && !Array.isArray(page.filters)) pageError("filters: must be an array");
    if (Array.isArray(page.filters)) {
      filters = [];
      const seenFilterIds = new Set<string>();
      for (const rawFilter of page.filters as Record<string, unknown>[]) {
        const r = PageFilter.safeParse(rawFilter);
        if (!r.success) {
          pageError(`filters: ${r.error.issues[0]?.message ?? "invalid"}`);
          continue;
        }
        if (seenFilterIds.has(r.data.id)) pageError(`duplicate filter id '${r.data.id}'`);
        seenFilterIds.add(r.data.id);
        for (const dataset of Object.keys(r.data.bind)) {
          if (!(dataset in datasets)) pageError(`filter '${r.data.id}': binds to unknown dataset '${dataset}'`);
        }
        filters.push(r.data);
      }
    }

    const hasIslands = Array.isArray(page.islands);
    const hasGroups = Array.isArray(page.groups);
    if (hasIslands === hasGroups) {
      pageError(
        hasIslands
          ? "a page declares either 'islands' or 'groups', not both"
          : "a page needs 'islands' or 'groups'",
      );
      normalizedPages.push({ id: pageId, layout: "grid", islands: [] });
      continue;
    }

    const base = {
      id: pageId,
      title: typeof page.title === "string" ? page.title : undefined,
      icon,
      filters,
      layout: "grid" as const,
    };

    if (hasIslands) {
      const islands = validateIslands(pageId, page.islands as Record<string, unknown>[], { index: 0 });
      normalizedPages.push({ ...base, islands: islands as IslandEntry[] });
      continue;
    }

    const seenGroupIds = new Set<string>();
    const normalizedGroups: Group[] = [];
    const counter = { index: 0 };
    for (const rawGroup of page.groups as Record<string, unknown>[]) {
      const groupId = typeof rawGroup.id === "string" ? rawGroup.id : "";
      if (!groupId) pageError("groups: every group needs a string 'id'");
      if (seenGroupIds.has(groupId)) pageError(`duplicate group id '${groupId}'`);
      seenGroupIds.add(groupId);
      const islands = Array.isArray(rawGroup.islands) ? (rawGroup.islands as Record<string, unknown>[]) : [];
      const normalized = validateIslands(pageId, islands, counter);
      normalizedGroups.push({
        id: groupId,
        title: typeof rawGroup.title === "string" ? rawGroup.title : undefined,
        islands: normalized as IslandEntry[],
      });
    }
    normalizedPages.push({ ...base, groups: normalizedGroups });
  }

  if (errors.length > 0) return { ok: false, errors, custom };

  const manifest: Manifest = {
    version: 1,
    title: String(root.title),
    icon: appIcon,
    datasets: datasets as Record<string, DatasetSpec>,
    pages: normalizedPages,
    actions: actions as Record<string, ActionSpec> | undefined,
    connectors: connectors as Record<string, ConnectorSpec> | undefined,
  };
  return { ok: true, manifest, errors, custom };
}
