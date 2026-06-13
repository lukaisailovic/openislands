import { Chart, type KumoChartOption, ChartPalette } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { IslandRenderProps } from "../types.js";
import { NoData } from "../components/EmptyState.js";
import { SeriesLegend } from "../components/SeriesLegend.js";
import { echarts } from "./echarts.js";
import { formatTimestamp, formatValue } from "./format.js";
import { formatAxisDate, tooltip, usePrefersDark } from "./chart.js";
import { buildBarData, isDateCategories } from "./CategoryBar.js";

interface ComboSpec {
  x: string;
  bars: string[];
  lines: string[];
  stacked: boolean;
  colors?: string[];
  format?: ValueFormat;
  lineFormat?: ValueFormat;
}

const asStringArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : v ? [v as string] : []);

function readSpec(config: IslandRenderProps["config"]): ComboSpec {
  return {
    x: config.x as string,
    bars: asStringArray(config.bars),
    lines: asStringArray(config.lines),
    stacked: config.stacked === true,
    colors: config.colors as string[] | undefined,
    format: config.format as ValueFormat | undefined,
    lineFormat: config.lineFormat as ValueFormat | undefined,
  };
}

function seriesColor(colors: string[] | undefined, i: number, dark: boolean): string {
  return colors?.[i] ?? ChartPalette.categorical(i, dark);
}

export function CategoryCombo({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  if (rows.length === 0) return <NoData />;

  const bars = buildBarData({ x: spec.x, ys: spec.bars, stacked: spec.stacked }, rows);
  const lines = buildBarData({ x: spec.x, ys: spec.lines, stacked: false }, rows);
  const categories = bars.categories.length > 0 ? bars.categories : lines.categories;
  const dates = isDateCategories(categories);
  const axisLabelColor = ChartPalette.text("secondary", dark);
  const barCount = bars.series.length;

  const options: KumoChartOption = {
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
    yAxis: [
      { type: "value", axisLabel: { color: axisLabelColor, formatter: (value: number) => formatValue(value, spec.format) } },
      {
        type: "value",
        position: "right",
        splitLine: { show: false },
        axisLabel: { color: axisLabelColor, formatter: (value: number) => formatValue(value, spec.lineFormat) },
      },
    ],
    series: [
      ...bars.series.map((s, i) => ({
        name: s.name,
        type: "bar" as const,
        stack: spec.stacked ? "total" : undefined,
        yAxisIndex: 0,
        data: s.data,
        itemStyle: { color: seriesColor(spec.colors, i, dark) },
      })),
      ...lines.series.map((s, i) => ({
        name: s.name,
        type: "line" as const,
        yAxisIndex: 1,
        smooth: true,
        data: s.data,
        itemStyle: { color: seriesColor(spec.colors, barCount + i, dark) },
        lineStyle: { color: seriesColor(spec.colors, barCount + i, dark) },
      })),
    ],
  };

  const legend = [
    ...bars.series.map((s, i) => ({ name: s.name, color: seriesColor(spec.colors, i, dark) })),
    ...lines.series.map((s, i) => ({ name: s.name, color: seriesColor(spec.colors, barCount + i, dark) })),
  ];

  return (
    <div className="w-full">
      <Chart echarts={echarts} options={options} isDarkMode={dark} height={260} />
      {legend.length > 0 ? <SeriesLegend items={legend} /> : null}
    </div>
  );
}
