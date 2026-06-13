import { Chart, ChartPalette, type KumoChartOption } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { escapeHtml, tooltip, usePrefersDark } from "./chart.js";
import { echarts } from "./echarts.js";
import { formatValue } from "./format.js";
import worldGeo from "./world.geo.json";

interface ChoroplethSpec {
  region: string;
  value: string;
  map: string;
  colors?: string[];
  format?: ValueFormat;
}

export interface ChoroplethItem {
  name: string;
  value: number;
}

export interface ChoroplethData {
  items: ChoroplethItem[];
  min: number;
  max: number;
}

function readSpec(config: IslandRenderProps["config"]): ChoroplethSpec {
  return {
    region: config.region as string,
    value: config.value as string,
    map: (config.map as string | undefined) ?? "world",
    colors: config.colors as string[] | undefined,
    format: config.format as ValueFormat | undefined,
  };
}

/**
 * Shape rows into ECharts map data: each region's name (the GeoJSON
 * `properties.name` join key) paired with a numeric value. Duplicate regions
 * sum, non-finite values drop, and `min`/`max` give the visualMap extent
 * (`0,0` when empty). Pure, so tests assert without a DOM or ECharts.
 */
export function buildChoroplethData(spec: ChoroplethSpec, rows: Row[]): ChoroplethData {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const raw = row[spec.value];
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const name = String(row[spec.region] ?? "");
    if (name === "") continue;
    totals.set(name, (totals.get(name) ?? 0) + value);
  }

  const items: ChoroplethItem[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const [name, value] of totals) {
    items.push({ name, value });
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (items.length === 0) return { items, min: 0, max: 0 };
  return { items, min, max };
}

const registeredMaps = new Set<string>();

/**
 * Register the vendored GeoJSON with the shared ECharts instance once per map
 * name, client-side only. `registerMap` touches the browser registry, so it
 * must never run during SSR; the guard also avoids re-registering on re-render.
 */
function ensureMapRegistered(mapName: string): void {
  if (typeof window === "undefined") return;
  if (registeredMaps.has(mapName)) return;
  echarts.registerMap(mapName, worldGeo as Parameters<typeof echarts.registerMap>[1]);
  registeredMaps.add(mapName);
}

/** A two-line item tooltip: the region above its formatted value (an em dash when the region has no datum). */
function choroplethTooltip(region: string, value: string): string {
  const header = `<div style="margin-bottom:4px;font-weight:600;">${escapeHtml(region)}</div>`;
  const body = `<div style="line-height:1.6;"><span style="font-weight:600;">${escapeHtml(value)}</span></div>`;
  return `${header}${body}`;
}

interface MapTooltipParam {
  name?: string;
  value?: unknown;
  data?: { value?: unknown } | null;
}

function buildOptions(spec: ChoroplethSpec, choropleth: ChoroplethData, dark: boolean): KumoChartOption {
  const textColor = ChartPalette.text("secondary", dark);
  const gradient = spec.colors?.length ? spec.colors : ChartPalette.sequential("blues", dark);
  const emptyAreaColor = dark ? "#2a3140" : "#eef1f5";
  const borderColor = dark ? "#3a4253" : "#d6dce4";

  return {
    backgroundColor: "transparent",
    tooltip: {
      ...tooltip({ trigger: "item", dark, format: spec.format }),
      dangerousHtmlFormatter: (params) => {
        const p = (Array.isArray(params) ? params[0] : params) as MapTooltipParam;
        const region = String(p?.name ?? "");
        const datum = p?.data?.value ?? p?.value;
        const hasValue = typeof datum === "number" && Number.isFinite(datum);
        return choroplethTooltip(region, hasValue ? formatValue(datum, spec.format) : "—");
      },
    },
    visualMap: {
      type: "continuous",
      min: choropleth.min,
      max: choropleth.max,
      calculable: true,
      orient: "vertical",
      left: 8,
      bottom: 8,
      inRange: { color: gradient },
      textStyle: { color: textColor },
      formatter: (value) => formatValue(Number(value), spec.format),
    },
    series: [
      {
        type: "map",
        map: spec.map,
        roam: false,
        label: { show: false },
        emphasis: { label: { show: false } },
        itemStyle: { borderColor, borderWidth: 0.5, areaColor: emptyAreaColor },
        data: choropleth.items,
      },
    ],
  };
}

export function MapChoropleth({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  ensureMapRegistered(spec.map);

  if (rows.length === 0) return <NoData />;

  return (
    <div className="w-full">
      <Chart
        echarts={echarts}
        options={buildOptions(spec, buildChoroplethData(spec, rows), dark)}
        isDarkMode={dark}
        height={300}
      />
    </div>
  );
}
