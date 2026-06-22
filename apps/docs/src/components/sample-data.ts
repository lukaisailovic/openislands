import type { LiveIslandData } from "./live-island";

export type { LiveIslandData };

/**
 * Build the `data` prop a `<LiveIsland>` feeds its renderer: the dataset name, a column
 * list (name + DuckDB-style type), and the rows. This is the same shape the runtime
 * hands an island after a query resolves, so islands in the docs behave exactly like
 * islands in a live dashboard.
 */
export function sampleData(
  columns: LiveIslandData["columns"],
  rows: LiveIslandData["rows"],
  dataset = "sample",
): LiveIslandData {
  return { dataset, columns, rows };
}

/** Six months of net worth — drives the metric.kpi proof (a value, a delta, a sparkline). */
export const netWorthByMonth: LiveIslandData = sampleData(
  [
    { name: "month", type: "date" },
    { name: "net_worth_eur", type: "double" },
  ],
  [
    { month: "2026-01-01", net_worth_eur: 118_400 },
    { month: "2026-02-01", net_worth_eur: 121_900 },
    { month: "2026-03-01", net_worth_eur: 120_300 },
    { month: "2026-04-01", net_worth_eur: 126_800 },
    { month: "2026-05-01", net_worth_eur: 131_200 },
    { month: "2026-06-01", net_worth_eur: 134_750 },
  ],
  "net_worth",
);
