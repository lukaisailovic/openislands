/**
 * Pure scaffolding helpers for the CLI — island skeletons, dataset-name
 * derivation, and island suggestions from an inferred schema. Kept out of
 * index.ts so tests can import them without triggering the CLI's top-level
 * program.parseAsync().
 */
export type ColumnType = "number" | "date" | "boolean" | "string";
export interface InferredColumn {
  name: string;
  type: ColumnType;
}

/** A valid starting config for every built-in island type, ready to drop in and edit. */
export function islandSkeleton(type: string): Record<string, unknown> {
  const base: Record<string, Record<string, unknown>> = {
    "metric.kpi": { type, title: "New metric", dataset: "TODO", value: "TODO" },
    "metric.scorecard": { type, title: "New scorecard", dataset: "TODO", stats: [{ value: "TODO" }] },
    "timeseries.line": { type, title: "New chart", dataset: "TODO", x: "TODO", y: "TODO" },
    "category.bar": { type, title: "New bars", dataset: "TODO", x: "TODO", y: "TODO" },
    "category.combo": { type, title: "New combo", dataset: "TODO", x: "TODO", bars: "TODO", lines: "TODO" },
    "breakdown.treemap": {
      type,
      title: "New breakdown",
      dataset: "TODO",
      label: "TODO",
      value: "TODO",
    },
    "category.pie": { type, title: "New pie", dataset: "TODO", label: "TODO", value: "TODO" },
    "correlation.scatter": { type, title: "New scatter", dataset: "TODO", x: "TODO", y: "TODO" },
    "distribution.heatmap": { type, title: "New heatmap", dataset: "TODO", x: "TODO", y: "TODO", value: "TODO" },
    "activity.calendar": { type, title: "New calendar", dataset: "TODO", date: "TODO", value: "TODO" },
    "funnel.steps": { type, title: "New funnel", dataset: "TODO", label: "TODO", value: "TODO" },
    "compare.radar": { type, title: "New radar", dataset: "TODO", metrics: ["TODO"] },
    "map.choropleth": { type, title: "New map", dataset: "TODO", region: "TODO", value: "TODO" },
    "table.grid": { type, title: "New table", dataset: "TODO" },
    "timeline.feed": {
      type,
      title: "New timeline",
      dataset: "TODO",
      ts: "TODO",
      titleField: "TODO",
    },
    "gauge.rings": { type, title: "New rings", dataset: "TODO", rings: [{ value: "TODO", max: "TODO" }] },
    "gauge.goal": { type, title: "New goal", dataset: "TODO", value: "TODO", goal: { max: "TODO" } },
    "gauge.meter": { type, title: "New meter", dataset: "TODO", meters: [{ value: "TODO", max: "TODO" }] },
    "search.box": { type, title: "New search", dataset: "TODO", fields: ["TODO"], titleField: "TODO" },
    "note.card": { type, title: "Note", markdown: "## Note\n\nWrite something." },
    "source.doc": { type, title: "Source", kind: "link", href: "https://" },
  };
  return base[type] ?? { type, title: "New island" };
}

/** A canonical dataset name from a file path: basename, lowercased, non-word runs collapsed to "_". */
export function datasetNameFromFile(file: string): string {
  const stem = (file.split(/[/\\]/).pop() ?? file).replace(/\.[^.]+$/, "");
  const name = stem
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return name || "dataset";
}

/** Up to four ready-to-paste islands inferred from a dataset's columns — starting points the user edits. */
export function suggestIslands(dataset: string, columns: InferredColumn[]): Record<string, unknown>[] {
  const dateCols = columns.filter((c) => c.type === "date");
  const numberCols = columns.filter((c) => c.type === "number");
  const stringCols = columns.filter((c) => c.type === "string");
  const islands: Record<string, unknown>[] = [];

  if (dateCols.length > 0 && numberCols.length > 0) {
    const y = numberCols.length > 1 ? numberCols.slice(0, 3).map((c) => c.name) : numberCols[0]!.name;
    islands.push({ type: "timeseries.line", title: "Over time", dataset, x: dateCols[0]!.name, y });
  }
  if (numberCols.length > 0) {
    islands.push({
      type: "metric.kpi",
      title: "Headline metric",
      dataset,
      value: numberCols[0]!.name,
      ...(dateCols.length > 0 ? { compareTo: "prev" } : {}),
    });
  }
  if (stringCols.length > 0 && numberCols.length > 0) {
    islands.push({ type: "category.bar", title: "By category", dataset, x: stringCols[0]!.name, y: numberCols[0]!.name });
    islands.push({ type: "breakdown.treemap", title: "Breakdown", dataset, label: stringCols[0]!.name, value: numberCols[0]!.name });
  }
  islands.push({ type: "table.grid", title: "All rows", dataset });

  return islands.slice(0, 4);
}
