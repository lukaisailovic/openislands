import { Chart, ChartPalette, type KumoChartOption } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import { SeriesLegend } from "../components/SeriesLegend.js";
import type { IslandRenderProps } from "../types.js";
import { escapeHtml, usePrefersDark } from "./chart.js";
import { echarts } from "./echarts.js";
import { formatValue, toNumber } from "./format.js";

interface ScatterSpec {
  x: string;
  y: string;
  series?: string;
  size?: string;
  label?: string;
  colors?: string[];
  format?: ValueFormat;
  xFormat?: ValueFormat;
}

/**
 * One point as ECharts consumes it: `[x, y]` always, with the raw size value
 * and the point label appended when configured. ECharts plots only the first
 * two; `symbolSize` reads index 2 and the tooltip reads the label at the end.
 */
export type ScatterPoint = [number, number, number?, string?];

export interface ScatterSeries {
  name: string;
  data: ScatterPoint[];
  color: string;
}

const SIZE_INDEX = 2;
const MIN_RADIUS = 8;
const MAX_RADIUS = 38;
const FIXED_RADIUS = 12;

function readSpec(config: IslandRenderProps["config"]): ScatterSpec {
  return {
    x: config.x as string,
    y: config.y as string,
    series: config.series as string | undefined,
    size: config.size as string | undefined,
    label: config.label as string | undefined,
    colors: config.colors as string[] | undefined,
    format: config.format as ValueFormat | undefined,
    xFormat: config.xFormat as ValueFormat | undefined,
  };
}

function seriesColor(spec: ScatterSpec, i: number, dark: boolean): string {
  return spec.colors?.[i] ?? ChartPalette.categorical(i, dark);
}

function toPoint(spec: ScatterSpec, row: Row): ScatterPoint | null {
  const x = toNumber(row[spec.x]);
  const y = toNumber(row[spec.y]);
  if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const point: ScatterPoint = [x, y];
  if (spec.size) point[SIZE_INDEX] = toNumber(row[spec.size]) ?? 0;
  if (spec.label) point[3] = String(row[spec.label] ?? "");
  return point;
}

/**
 * Shape rows into ECharts scatter series. Pure, so tests assert without a DOM
 * or ECharts. Rows with a non-finite x or y are dropped. With `series` set,
 * points are grouped into one colored series per distinct value in first-seen
 * order; otherwise a single unnamed series.
 */
export function buildScatterSeries(spec: ScatterSpec, rows: Row[], dark: boolean): ScatterSeries[] {
  if (spec.series) {
    const groups = new Map<string, ScatterPoint[]>();
    for (const row of rows) {
      const point = toPoint(spec, row);
      if (point === null) continue;
      const name = String(row[spec.series] ?? "");
      let points = groups.get(name);
      if (!points) {
        points = [];
        groups.set(name, points);
      }
      points.push(point);
    }
    return [...groups.entries()].map(([name, data], i) => ({
      name,
      data,
      color: seriesColor(spec, i, dark),
    }));
  }

  const data: ScatterPoint[] = [];
  for (const row of rows) {
    const point = toPoint(spec, row);
    if (point !== null) data.push(point);
  }
  return [{ name: spec.y, data, color: seriesColor(spec, 0, dark) }];
}

/**
 * A linear map of a size value into the pixel-radius range. Degenerate spreads
 * (min === max, or fewer than two points) collapse to the midpoint so every
 * bubble stays legibly sized rather than pinned to the minimum.
 */
export function scaleSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return MIN_RADIUS;
  if (max <= min) return (MIN_RADIUS + MAX_RADIUS) / 2;
  const t = (value - min) / (max - min);
  return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
}

function sizeExtent(series: ScatterSeries[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const point of s.data) {
      const size = point[SIZE_INDEX];
      if (size === undefined || !Number.isFinite(size)) continue;
      if (size < min) min = size;
      if (size > max) max = size;
    }
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

interface ScatterTooltipParams {
  marker?: string;
  seriesName?: string;
  value?: unknown;
}

function tooltipRow(label: string, value: string): string {
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;line-height:1.6;"><span style="color:inherit;opacity:0.75;">${escapeHtml(
    label,
  )}</span><span style="font-weight:600;">${escapeHtml(value)}</span></div>`;
}

/**
 * A per-point tooltip matching the shared Kumo tooltip surface (see chart.ts
 * `tooltipSurface`). The shared `tooltip` helper only renders a single value,
 * so a multi-field point (label, x, y, size) needs this dedicated formatter.
 */
function buildTooltip(spec: ScatterSpec, dark: boolean): NonNullable<KumoChartOption["tooltip"]> {
  return {
    appendTo: () => (typeof document === "undefined" ? null : document.body),
    confine: true,
    trigger: "item",
    backgroundColor: dark ? "#1f2430" : "#ffffff",
    borderColor: dark ? "#2f3645" : "#e5e7eb",
    borderWidth: 1,
    padding: [6, 10],
    textStyle: { color: dark ? "#e5e7eb" : "#1f2937", fontSize: 12 },
    extraCssText: "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.18);",
    dangerousHtmlFormatter: (raw) => {
      const params = (Array.isArray(raw) ? raw[0] : raw) as ScatterTooltipParams | undefined;
      const value = Array.isArray(params?.value) ? (params.value as unknown[]) : [];
      const label = spec.label ? (value[3] as string | undefined) : undefined;
      const header =
        label || (spec.series && params?.seriesName)
          ? `<div style="margin-bottom:4px;font-weight:600;">${escapeHtml(
              String(label ?? params?.seriesName ?? ""),
            )}</div>`
          : "";
      const rows = [
        tooltipRow(spec.x, formatValue(value[0] as number, spec.xFormat)),
        tooltipRow(spec.y, formatValue(value[1] as number, spec.format)),
      ];
      if (spec.size && value[SIZE_INDEX] !== undefined) {
        rows.push(tooltipRow(spec.size, formatValue(value[SIZE_INDEX] as number)));
      }
      return `${header}${rows.join("")}`;
    },
  };
}

function buildOptions(spec: ScatterSpec, series: ScatterSeries[], dark: boolean): KumoChartOption {
  const axisLabelColor = ChartPalette.text("secondary", dark);
  const { min, max } = sizeExtent(series);
  const symbolSize = spec.size
    ? (value: ScatterPoint) => scaleSize(value[SIZE_INDEX] ?? 0, min, max)
    : FIXED_RADIUS;
  return {
    backgroundColor: "transparent",
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: buildTooltip(spec, dark),
    xAxis: {
      type: "value",
      scale: true,
      axisLabel: {
        color: axisLabelColor,
        formatter: (value: number) => formatValue(value, spec.xFormat),
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: {
        color: axisLabelColor,
        formatter: (value: number) => formatValue(value, spec.format),
      },
    },
    series: series.map((s) => ({
      name: s.name,
      type: "scatter",
      data: s.data,
      symbolSize,
      itemStyle: { color: s.color, opacity: 0.8 },
    })),
  };
}

export function CorrelationScatter({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  if (rows.length === 0) return <NoData />;

  const series = buildScatterSeries(spec, rows, dark);
  const legend =
    spec.series && series.length > 1
      ? series.map((s) => ({ name: s.name, color: s.color }))
      : [];
  return (
    <div className="w-full">
      <Chart
        echarts={echarts}
        options={buildOptions(spec, series, dark)}
        isDarkMode={dark}
        height={260}
      />
      {legend.length > 0 ? <SeriesLegend items={legend} /> : null}
    </div>
  );
}
