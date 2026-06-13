import { Chart, ChartPalette, type KumoChartOption } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { escapeHtml, tooltip, usePrefersDark } from "./chart.js";
import { echarts } from "./echarts.js";
import { formatValue, toNumber } from "./format.js";

interface HeatmapSpec {
  x: string;
  y: string;
  value: string;
  colors?: string[];
  format?: ValueFormat;
}

export interface HeatmapData {
  xs: string[];
  ys: string[];
  cells: [number, number, number][];
  min: number;
  max: number;
}

type SeriesOption = Extract<NonNullable<KumoChartOption["series"]>, unknown[]>[number];
type HeatmapSeries = Extract<SeriesOption, { type?: "heatmap" }>;
type LabelFormatterParams = { value: [number, number, number] };

function readSpec(config: IslandRenderProps["config"]): HeatmapSpec {
  return {
    x: config.x as string,
    y: config.y as string,
    value: config.value as string,
    colors: config.colors as string[] | undefined,
    format: config.format as ValueFormat | undefined,
  };
}

/**
 * Pivot rows into an x-category × y-category matrix. `xs`/`ys` are the distinct
 * categories in first-seen order; `cells` are `[xIndex, yIndex, value]` with the
 * last value winning per cell and non-finite values dropped. Pure, so tests
 * assert without a DOM or ECharts.
 */
export function buildHeatmapData(spec: HeatmapSpec, rows: Row[]): HeatmapData {
  const xs: string[] = [];
  const ys: string[] = [];
  const xIndex = new Map<string, number>();
  const yIndex = new Map<string, number>();
  const byCell = new Map<string, number>();

  for (const row of rows) {
    const value = toNumber(row[spec.value]);
    if (value === null) continue;

    const x = String(row[spec.x] ?? "");
    const y = String(row[spec.y] ?? "");
    if (!xIndex.has(x)) {
      xIndex.set(x, xs.length);
      xs.push(x);
    }
    if (!yIndex.has(y)) {
      yIndex.set(y, ys.length);
      ys.push(y);
    }
    byCell.set(`${xIndex.get(x)},${yIndex.get(y)}`, value);
  }

  const cells: [number, number, number][] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const [key, value] of byCell) {
    const [xi, yi] = key.split(",").map(Number) as [number, number];
    cells.push([xi, yi, value]);
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (cells.length === 0) return { xs, ys, cells, min: 0, max: 0 };
  return { xs, ys, cells, min, max };
}

function buildOptions(spec: HeatmapSpec, heatmap: HeatmapData, dark: boolean): KumoChartOption {
  const axisLabelColor = ChartPalette.text("secondary", dark);
  const labelFor = (value: number) => formatValue(value, spec.format);
  const dense = heatmap.xs.length * heatmap.ys.length > 100;
  const gradient = spec.colors?.length ? spec.colors : ChartPalette.sequential("blues", dark);

  const label: HeatmapSeries["label"] = dense
    ? { show: false }
    : {
        show: true,
        fontSize: 10,
        formatter: (p) => labelFor((p as unknown as LabelFormatterParams).value[2]),
      };

  return {
    backgroundColor: "transparent",
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltip({ trigger: "item", dark, format: spec.format }),
      dangerousHtmlFormatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        const cell = (p?.value ?? []) as [number, number, number];
        const x = heatmap.xs[cell[0]] ?? "";
        const y = heatmap.ys[cell[1]] ?? "";
        return heatmapTooltip(x, y, labelFor(cell[2]));
      },
    },
    xAxis: {
      type: "category",
      data: heatmap.xs,
      splitArea: { show: true },
      axisLabel: { color: axisLabelColor, hideOverlap: true },
    },
    yAxis: {
      type: "category",
      data: heatmap.ys,
      splitArea: { show: true },
      axisLabel: { color: axisLabelColor },
    },
    visualMap: {
      type: "continuous",
      min: heatmap.min,
      max: heatmap.max,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: { color: gradient },
      textStyle: { color: axisLabelColor },
      formatter: (value) => labelFor(Number(value)),
    },
    series: [
      {
        type: "heatmap",
        data: heatmap.cells,
        label,
        itemStyle: { borderColor: "transparent", borderWidth: 1 },
      },
    ],
  };
}

/** A two-line Kumo-styled item tooltip: the x × y cell label above its formatted value. */
function heatmapTooltip(x: string, y: string, value: string): string {
  const header = `<div style="margin-bottom:4px;font-weight:600;">${escapeHtml(x)} · ${escapeHtml(y)}</div>`;
  const body = `<div style="line-height:1.6;"><span style="font-weight:600;">${escapeHtml(value)}</span></div>`;
  return `${header}${body}`;
}

export function DistributionHeatmap({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  if (rows.length === 0) return <NoData />;

  return (
    <div className="w-full">
      <Chart
        echarts={echarts}
        options={buildOptions(spec, buildHeatmapData(spec, rows), dark)}
        isDarkMode={dark}
        height={260}
      />
    </div>
  );
}
