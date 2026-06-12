import { Chart, type KumoChartOption, ChartPalette } from "@cloudflare/kumo";
import { ChartBar } from "@phosphor-icons/react";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { ChartEmpty } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { SeriesLegend } from "../components/SeriesLegend.js";
import { echarts } from "./echarts.js";
import { formatTimestamp, formatValue } from "./format.js";
import { formatAxisDate, tooltip, usePrefersDark } from "./chart.js";

interface BarSpec {
  x: string;
  ys: string[];
  group?: string;
  stacked: boolean;
  colors?: string[];
  format?: ValueFormat;
}

export interface BarSeries {
  name: string;
  data: number[];
}

export interface BarData {
  categories: string[];
  series: BarSeries[];
}

function readSpec(config: IslandRenderProps["config"]): BarSpec {
  const y = config.y;
  const ys = Array.isArray(y) ? (y as string[]) : [y as string];
  return {
    x: config.x as string,
    ys,
    group: config.group as string | undefined,
    stacked: config.stacked === true,
    colors: config.colors as string[] | undefined,
    format: config.format as ValueFormat | undefined,
  };
}

/** Shape rows into categorical bar series. Pure, so tests assert without a DOM or ECharts. */
export function buildBarData(spec: BarSpec, rows: Row[]): BarData {
  const categories: string[] = [];
  for (const row of rows) {
    const category = String(row[spec.x] ?? "");
    if (!categories.includes(category)) categories.push(category);
  }

  if (spec.group) {
    const byGroup = new Map<string, Map<string, number>>();
    const y = spec.ys[0]!;
    for (const row of rows) {
      const group = String(row[spec.group] ?? "");
      const category = String(row[spec.x] ?? "");
      let column = byGroup.get(group);
      if (!column) {
        column = new Map();
        byGroup.set(group, column);
      }
      column.set(category, Number(row[y]) || 0);
    }
    const series = [...byGroup].map(([name, column]) => ({
      name,
      data: categories.map((category) => column.get(category) ?? 0),
    }));
    return { categories, series };
  }

  const series = spec.ys.map((field) => ({
    name: field,
    data: categories.map((category) => {
      const row = rows.find((r) => String(r[spec.x] ?? "") === category);
      return row ? Number(row[field]) || 0 : 0;
    }),
  }));
  return { categories, series };
}

/** True when every category is an ISO date (with or without a time part). */
export function isDateCategories(categories: string[]): boolean {
  return categories.length > 0 && categories.every((c) => /^\d{4}-\d{2}-\d{2}([ T]|$)/.test(c));
}

function seriesColor(spec: BarSpec, i: number, dark: boolean): string {
  return spec.colors?.[i] ?? ChartPalette.categorical(i, dark);
}

function buildOptions(spec: BarSpec, data: BarData, dark: boolean): KumoChartOption {
  const axisLabelColor = ChartPalette.text("secondary", dark);
  const stack = spec.stacked ? "total" : undefined;
  const dates = isDateCategories(data.categories);
  return {
    backgroundColor: "transparent",
    grid: { left: 56, right: 16, top: 16, bottom: 32 },
    tooltip: tooltip({
      trigger: "axis",
      dark,
      format: spec.format,
      axisFormat: (value) => (dates ? formatTimestamp(String(value)) : String(value ?? "")),
    }),
    xAxis: {
      type: "category",
      data: data.categories,
      axisLabel: {
        color: axisLabelColor,
        hideOverlap: true,
        formatter: dates
          ? (category: string) =>
              formatAxisDate(Date.parse(`${category.slice(0, 10)}T00:00:00Z`), false)
          : undefined,
      },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: axisLabelColor,
        formatter: (value: number) => formatValue(value, spec.format),
      },
    },
    series: data.series.map((s, i) => ({
      name: s.name,
      type: "bar",
      stack,
      data: s.data,
      itemStyle: { color: seriesColor(spec, i, dark) },
    })),
  };
}

export function CategoryBar({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  if (rows.length === 0) return <ChartEmpty icon={<ChartBar size={24} weight="duotone" />} />;

  const barData = buildBarData(spec, rows);
  const legend =
    barData.series.length > 1
      ? barData.series.map((s, i) => ({ name: s.name, color: seriesColor(spec, i, dark) }))
      : [];
  return (
    <div className="w-full">
      <Chart
        echarts={echarts}
        options={buildOptions(spec, barData, dark)}
        isDarkMode={dark}
        height={260}
      />
      {legend.length > 0 ? <SeriesLegend items={legend} /> : null}
    </div>
  );
}
