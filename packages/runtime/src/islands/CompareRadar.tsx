import { Chart, ChartPalette, type KumoChartOption } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import { SeriesLegend } from "../components/SeriesLegend.js";
import type { IslandRenderProps } from "../types.js";
import { escapeHtml, tooltip, usePrefersDark } from "./chart.js";
import { echarts } from "./echarts.js";
import { formatValue, toNumber } from "./format.js";

interface RadarSpec {
  metrics: string[];
  series?: string;
  max?: number;
  colors?: string[];
  format?: ValueFormat;
}

export interface RadarIndicator {
  name: string;
  max: number;
}

export interface RadarSeries {
  name: string;
  value: number[];
}

export interface RadarData {
  indicators: RadarIndicator[];
  series: RadarSeries[];
}

function readSpec(config: IslandRenderProps["config"]): RadarSpec {
  const metrics = config.metrics;
  return {
    metrics: Array.isArray(metrics) ? (metrics as string[]) : [metrics as string],
    series: config.series as string | undefined,
    max: config.max as number | undefined,
    colors: config.colors as string[] | undefined,
    format: config.format as ValueFormat | undefined,
  };
}

/** Round a positive max up to a clean tick (1/2/5 × 10ⁿ) so the outer ring sits just past the data. */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Shape rows into ECharts radar indicators + polygons. Pure, so tests assert
 * without a DOM or ECharts. Each metric becomes one axis; each row becomes one
 * polygon. A fixed `max` applies to every axis, otherwise each axis maxes at
 * that metric's largest value across rows (rounded up, falling back to 1).
 */
export function buildRadarData(spec: RadarSpec, rows: Row[]): RadarData {
  const indicators = spec.metrics.map((metric) => {
    if (spec.max !== undefined) return { name: metric, max: spec.max };
    let peak = 0;
    for (const row of rows) {
      const value = toNumber(row[metric]);
      if (value !== null && value > peak) peak = value;
    }
    return { name: metric, max: peak > 0 ? niceCeil(peak) : 1 };
  });

  const series = rows.map((row, i) => ({
    name: spec.series ? String(row[spec.series] ?? "") : `Series ${i + 1}`,
    value: spec.metrics.map((metric) => toNumber(row[metric]) ?? 0),
  }));

  return { indicators, series };
}

function seriesColor(spec: RadarSpec, i: number, dark: boolean): string {
  return spec.colors?.[i] ?? ChartPalette.categorical(i, dark);
}

/** ECharts radar item tooltips carry the whole value array per polygon, so list each axis by name. */
function radarTooltip(spec: RadarSpec, indicators: RadarIndicator[], dark: boolean) {
  const base = tooltip({ trigger: "item", dark, format: spec.format });
  return {
    ...base,
    dangerousHtmlFormatter: (params: unknown) => {
      const param = (Array.isArray(params) ? params[0] : params) as {
        name?: string;
        color?: string;
        value?: unknown;
      };
      const values = Array.isArray(param?.value) ? param.value : [];
      const header = `<div style="margin-bottom:4px;font-weight:600;">${escapeHtml(
        String(param?.name ?? ""),
      )}</div>`;
      const marker = param?.color
        ? `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;background:${String(
            param.color,
          )};"></span>`
        : "";
      const lines = indicators
        .map((indicator, i) => {
          const value = formatValue(toNumber(values[i]) ?? 0, spec.format);
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;line-height:1.6;"><span>${marker}${escapeHtml(
            indicator.name,
          )}</span><span style="font-weight:600;">${escapeHtml(value)}</span></div>`;
        })
        .join("");
      return `${header}${lines}`;
    },
  };
}

function buildOptions(spec: RadarSpec, data: RadarData, dark: boolean): KumoChartOption {
  const splitLineColor = dark ? "rgba(148,163,184,0.22)" : "rgba(100,116,139,0.18)";
  return {
    backgroundColor: "transparent",
    tooltip: radarTooltip(spec, data.indicators, dark),
    radar: {
      indicator: data.indicators,
      center: ["50%", "54%"],
      radius: "66%",
      axisName: { color: ChartPalette.text("secondary", dark) },
      splitLine: { lineStyle: { color: splitLineColor } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: splitLineColor } },
    },
    series: [
      {
        type: "radar",
        symbolSize: 4,
        data: data.series.map((polygon, i) => {
          const color = seriesColor(spec, i, dark);
          return {
            name: polygon.name,
            value: polygon.value,
            lineStyle: { width: 2, color },
            itemStyle: { color },
            areaStyle: { color, opacity: 0.12 },
          };
        }),
      },
    ],
  };
}

export function CompareRadar({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  if (rows.length === 0) return <NoData />;

  const radarData = buildRadarData(spec, rows);
  const legend =
    radarData.series.length > 1
      ? radarData.series.map((polygon, i) => ({
          name: polygon.name,
          color: seriesColor(spec, i, dark),
        }))
      : [];
  return (
    <div className="w-full">
      <Chart
        echarts={echarts}
        options={buildOptions(spec, radarData, dark)}
        isDarkMode={dark}
        height={280}
      />
      {legend.length > 0 ? <SeriesLegend items={legend} /> : null}
    </div>
  );
}
