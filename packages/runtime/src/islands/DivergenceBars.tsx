import { Chart, type KumoChartOption, ChartPalette } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { SeriesLegend } from "../components/SeriesLegend.js";
import { echarts } from "./echarts.js";
import { formatTimestamp, formatValue, toNumber } from "./format.js";
import { formatAxisDate, tooltip, usePrefersDark } from "./chart.js";
import { isDateCategories } from "./CategoryBar.js";

export interface DivergenceBucket {
  gte?: number;
  lt?: number;
  color: string;
  label?: string;
}

interface DivergenceSpec {
  x: string;
  value: string;
  buckets: DivergenceBucket[];
  format?: ValueFormat;
}

const UNMATCHED = "#8e8e93";

/** Two implicit bands when the author gives none: green at/above zero, red below. */
const DEFAULT_BUCKETS: DivergenceBucket[] = [
  { gte: 0, color: "#34c759" },
  { lt: 0, color: "#ff375f" },
];

function readSpec(config: IslandRenderProps["config"]): DivergenceSpec {
  const buckets = config.buckets as DivergenceBucket[] | undefined;
  return {
    x: config.x as string,
    value: config.value as string,
    buckets: buckets && buckets.length > 0 ? buckets : DEFAULT_BUCKETS,
    format: config.format as ValueFormat | undefined,
  };
}

/** First band (in order) whose half-open [gte, lt) range contains the value; neutral grey if none. Pure, so tests assert without ECharts. */
export function bucketColor(value: number, buckets: DivergenceBucket[]): string {
  const match = buckets.find(
    (b) => (b.gte === undefined || value >= b.gte) && (b.lt === undefined || value < b.lt),
  );
  return match?.color ?? UNMATCHED;
}

export interface DivergenceBar {
  category: string;
  value: number;
  color: string;
}

/** Map rows to signed bars with their band color, skipping rows whose value isn't a number. Pure, so tests assert without ECharts. */
export function buildDivergenceBars(spec: DivergenceSpec, rows: Row[]): DivergenceBar[] {
  const bars: DivergenceBar[] = [];
  for (const row of rows) {
    const value = toNumber(row[spec.value]);
    if (value === null) continue;
    bars.push({ category: String(row[spec.x] ?? ""), value, color: bucketColor(value, spec.buckets) });
  }
  return bars;
}

function buildOptions(spec: DivergenceSpec, bars: DivergenceBar[], dark: boolean): KumoChartOption {
  const axisLabelColor = ChartPalette.text("secondary", dark);
  const categories = bars.map((b) => b.category);
  const dates = isDateCategories(categories);
  return {
    backgroundColor: "transparent",
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: tooltip({
      trigger: "axis",
      dark,
      format: spec.format,
      axisFormat: (value) => (dates ? formatTimestamp(String(value)) : String(value ?? "")),
    }),
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: {
        color: axisLabelColor,
        hideOverlap: true,
        formatter: dates
          ? (category: string) => formatAxisDate(Date.parse(`${category.slice(0, 10)}T00:00:00Z`), false)
          : undefined,
      },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: axisLabelColor, formatter: (value: number) => formatValue(value, spec.format) },
    },
    series: [
      {
        type: "bar",
        data: bars.map((bar) => ({ value: bar.value, itemStyle: { color: bar.color } })),
      },
    ],
  };
}

export function DivergenceBars({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  if (rows.length === 0) return <NoData />;

  const bars = buildDivergenceBars(spec, rows);
  const legend = spec.buckets.filter((b) => b.label).map((b) => ({ name: b.label!, color: b.color }));
  return (
    <div className="w-full">
      <Chart echarts={echarts} options={buildOptions(spec, bars, dark)} isDarkMode={dark} height={260} />
      {legend.length > 0 ? <SeriesLegend items={legend} /> : null}
    </div>
  );
}
