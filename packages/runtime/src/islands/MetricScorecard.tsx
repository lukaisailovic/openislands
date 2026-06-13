import { Badge, Text } from "@cloudflare/kumo";
import { TrendDown, TrendUp } from "@phosphor-icons/react";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { type Delta, computeDelta, formatValue } from "./format.js";

interface StatSpec {
  value: string;
  label?: string;
  format?: ValueFormat;
  unit?: string;
  compareTo?: "prev" | "none";
}

interface ScorecardSpec {
  stats: StatSpec[];
  columns?: number;
}

export interface ScorecardStat {
  label: string;
  display: string;
  unit?: string;
  delta: Delta | null;
}

function readSpec(config: IslandRenderProps["config"]): ScorecardSpec {
  return {
    stats: (config.stats as StatSpec[] | undefined) ?? [],
    columns: config.columns as number | undefined,
  };
}

/**
 * Read each configured stat off the last row, with an optional delta vs the
 * previous row when `compareTo` is "prev" and there is a previous row. The
 * label falls back to the field name. Pure, so tests assert without a DOM.
 */
export function buildScorecardStats(spec: Pick<ScorecardSpec, "stats">, rows: Row[]): ScorecardStat[] {
  const last = rows.at(-1) ?? {};
  const prev = rows.at(-2) ?? {};
  return spec.stats.map((stat) => ({
    label: stat.label ?? stat.value,
    display: formatValue(last[stat.value] ?? null, stat.format),
    unit: stat.unit,
    delta:
      stat.compareTo === "prev" && rows.length > 1
        ? computeDelta(last[stat.value] ?? null, prev[stat.value] ?? null)
        : null,
  }));
}

// Static class names so Tailwind sees them; dynamic interpolation would be purged.
const COLUMN_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

function gridClass(columns: number | undefined): string {
  if (columns && COLUMN_CLASS[columns]) return COLUMN_CLASS[columns];
  return "grid-cols-2 sm:grid-cols-3";
}

export function MetricScorecard({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  if (rows.length === 0) return <NoData />;

  const stats = buildScorecardStats(spec, rows);

  return (
    <div className={`grid h-full content-center gap-x-6 gap-y-4 ${gridClass(spec.columns)}`}>
      {stats.map((stat, i) => (
        <div key={i} className="flex flex-col gap-1">
          <Text variant="secondary" size="sm">
            {stat.label}
          </Text>
          <div
            className="flex items-center gap-2"
            {...(stat.delta ? { "data-testid": "scorecard-stat", "data-direction": stat.delta.direction } : {})}
          >
            <Text
              variant="heading3"
              as="span"
              DANGEROUS_className="font-medium tabular-nums tracking-tight"
            >
              {stat.display}
              {stat.unit ? (
                <Text variant="secondary" size="sm" as="span" DANGEROUS_className="ml-1">
                  {stat.unit}
                </Text>
              ) : null}
            </Text>
            {stat.delta ? (
              <Badge variant={stat.delta.direction === "up" ? "success" : "destructive"}>
                {stat.delta.direction === "up" ? <TrendUp size={12} /> : <TrendDown size={12} />}
                {Math.abs(stat.delta.pct).toFixed(1)}%
              </Badge>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
