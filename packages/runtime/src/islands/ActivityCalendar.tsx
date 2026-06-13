import { Chart, ChartPalette, type KumoChartOption } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { escapeHtml, usePrefersDark } from "./chart.js";
import { echarts } from "./echarts.js";
import { formatValue, toNumber } from "./format.js";
import { parseTimestamp } from "./TimeseriesLine.js";

interface CalendarSpec {
  date: string;
  value: string;
  colors?: string[];
  format?: ValueFormat;
}

export interface CalendarData {
  /** ECharts calendar/heatmap data: [UTC YYYY-MM-DD, value]. */
  points: [string, number][];
  /** [minDate, maxDate] as UTC YYYY-MM-DD — the calendar's visible span. */
  range: [string, string];
  min: number;
  max: number;
}

function readSpec(config: IslandRenderProps["config"]): CalendarSpec {
  return {
    date: config.date as string,
    value: config.value as string,
    colors: config.colors as string[] | undefined,
    format: config.format as ValueFormat | undefined,
  };
}

const MS_PER_DAY = 86_400_000;

/** Epoch ms → UTC calendar day, the date string ECharts' calendar coordinate expects. */
function toUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Shape rows into ECharts calendar/heatmap data. Each row's date is parsed to
 * epoch ms (reusing the timeseries parser), bucketed into a UTC calendar day,
 * and its numeric value summed with any other rows on that day. Unparseable
 * dates and non-finite values are dropped. `range` spans the earliest to the
 * latest day so the calendar shows exactly the data's window; `min`/`max` are
 * the value extent feeding the visualMap gradient. Pure — tests assert without
 * a DOM or ECharts.
 */
export function buildCalendarData(spec: CalendarSpec, rows: Row[]): CalendarData {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const ms = parseTimestamp(row[spec.date]);
    const value = toNumber(row[spec.value]);
    if (ms === null || value === null || !Number.isFinite(value)) continue;
    const day = toUtcDay(ms);
    byDay.set(day, (byDay.get(day) ?? 0) + value);
  }

  if (byDay.size === 0) return { points: [], range: ["", ""], min: 0, max: 0 };

  const points = [...byDay.entries()].toSorted(([a], [b]) => (a < b ? -1 : 1));
  const days = points.map(([day]) => day);
  const values = points.map(([, value]) => value);
  return {
    points,
    range: [days[0]!, days.at(-1)!],
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/**
 * Spread a single-day span by a day on each side. A one-cell calendar reads as
 * a glitch; padding gives the heatmap a legible frame to sit in.
 */
function paddedRange([start, end]: [string, string]): [string, string] {
  if (start !== end) return [start, end];
  const ms = Date.parse(`${start}T00:00:00Z`);
  return [toUtcDay(ms - MS_PER_DAY), toUtcDay(ms + MS_PER_DAY)];
}

function calendarTooltip(spec: CalendarSpec, dark: boolean): KumoChartOption["tooltip"] {
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
    dangerousHtmlFormatter: (params) => {
      const item = Array.isArray(params) ? params[0] : params;
      const value = (item?.value ?? []) as [string, number];
      const day = formatValue(value[0], "date");
      const amount = formatValue(value[1], spec.format);
      return (
        `<div style="margin-bottom:4px;font-weight:600;">${escapeHtml(day)}</div>` +
        `<div style="line-height:1.6;font-weight:600;">${escapeHtml(amount)}</div>`
      );
    },
  };
}

function buildOptions(spec: CalendarSpec, data: CalendarData, dark: boolean): KumoChartOption {
  const labelColor = ChartPalette.text("secondary", dark);
  const subtle = dark ? "#2f3645" : "#e5e7eb";
  return {
    backgroundColor: "transparent",
    tooltip: calendarTooltip(spec, dark),
    visualMap: {
      type: "continuous",
      min: data.min,
      max: data.max,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 12,
      inRange: {
        color: spec.colors?.length ? spec.colors : ChartPalette.sequential("blues", dark),
      },
      textStyle: { color: labelColor },
      formatter: (value) => formatValue(value as number, spec.format),
    },
    calendar: {
      range: paddedRange(data.range),
      cellSize: ["auto", 16],
      top: 30,
      left: 30,
      right: 10,
      orient: "horizontal",
      splitLine: { show: true, lineStyle: { color: subtle } },
      itemStyle: { color: "transparent", borderColor: subtle, borderWidth: 1 },
      dayLabel: { color: labelColor, firstDay: 1 },
      monthLabel: { color: labelColor },
      yearLabel: { show: false },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: data.points,
      },
    ],
  };
}

export function ActivityCalendar({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  if (rows.length === 0) return <NoData />;

  const calendarData = buildCalendarData(spec, rows);
  if (calendarData.points.length === 0) return <NoData />;

  return (
    <div className="w-full">
      <Chart
        echarts={echarts}
        options={buildOptions(spec, calendarData, dark)}
        isDarkMode={dark}
        height={220}
      />
    </div>
  );
}
