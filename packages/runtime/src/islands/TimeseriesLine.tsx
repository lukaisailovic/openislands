import { useState } from "react";
import {
  ChartLegend,
  ChartPalette,
  Combobox,
  Select,
  TimeseriesChart,
} from "@cloudflare/kumo";
import type { TimeseriesData } from "@cloudflare/kumo/components/chart";
import { ChartLine } from "@phosphor-icons/react";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { ChartEmpty } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { echarts } from "./echarts.js";
import { formatValue, toNumber } from "./format.js";
import { formatAxisDate, hasMeaningfulTime, usePrefersDark } from "./chart.js";

interface LineSpec {
  x: string;
  ys: string[];
  series?: string;
  colors?: string[];
  goalField?: string;
  area: boolean;
  format?: ValueFormat;
  seriesPicker?: boolean;
}

function readSpec(config: IslandRenderProps["config"]): LineSpec {
  const y = config.y;
  const ys = Array.isArray(y) ? (y as string[]) : [y as string];
  const options = (config.options as Record<string, unknown> | undefined) ?? {};
  return {
    x: config.x as string,
    ys,
    series: config.series as string | undefined,
    colors: config.colors as string[] | undefined,
    goalField: options.goalField as string | undefined,
    area: options.area === true,
    format: config.format as ValueFormat | undefined,
    seriesPicker: options.seriesPicker as boolean | undefined,
  };
}

const MONTH_ONLY = /^\d{4}-\d{2}$/;
const ISO_WEEK = /^(\d{4})-W(\d{2})$/;

/** Above this many distinct series values, auto-pick instead of drawing them all. */
const AUTO_PICK_THRESHOLD = 8;
/** Above this many options, the picker needs to be searchable. */
const SEARCHABLE_THRESHOLD = 15;

/** Monday of an ISO week, in epoch ms. */
function isoWeekStart(year: number, week: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - jan4Weekday * 86_400_000 + (week - 1) * 7 * 86_400_000;
}

/** Parse an x value into epoch ms. Accepts "YYYY-MM", "YYYY-Www", "YYYY-MM-DD", Date, and numbers. */
export function parseTimestamp(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const week = ISO_WEEK.exec(value);
  if (week) return isoWeekStart(Number(week[1]), Number(week[2]));
  const iso = MONTH_ONLY.test(value) ? `${value}-01` : value;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Distinct series-field values in first-seen data order. */
export function distinctSeries(spec: LineSpec, rows: Row[]): string[] {
  if (!spec.series) return [];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of rows) {
    if (parseTimestamp(row[spec.x]) === null || toNumber(row[spec.ys[0]!]) === null) continue;
    const name = String(row[spec.series]);
    if (seen.has(name)) continue;
    seen.add(name);
    order.push(name);
  }
  return order;
}

/**
 * Whether the series picker should be shown, and how. Automatic above
 * {@link AUTO_PICK_THRESHOLD} distinct values; `seriesPicker` forces or disables it.
 */
export function pickerMode(
  spec: LineSpec,
  count: number,
): "none" | "select" | "combobox" {
  if (!spec.series) return "none";
  if (spec.seriesPicker === false) return "none";
  const pick = spec.seriesPicker === true || count > AUTO_PICK_THRESHOLD;
  if (!pick) return "none";
  return count > SEARCHABLE_THRESHOLD ? "combobox" : "select";
}

/**
 * Shape rows into Kumo TimeseriesData series. Pure, so tests assert without a DOM or ECharts.
 * When `selected` is given (the series picker is active), only that series value is shaped.
 */
export function buildLineSeries(
  spec: LineSpec,
  rows: Row[],
  dark: boolean,
  selected?: string,
): TimeseriesData[] {
  if (spec.series) {
    const y = spec.ys[0]!;
    const groups = new Map<string, [number, number][]>();
    for (const row of rows) {
      const name = String(row[spec.series]);
      if (selected !== undefined && name !== selected) continue;
      const ts = parseTimestamp(row[spec.x]);
      const v = toNumber(row[y]);
      if (ts === null || v === null) continue;
      let points = groups.get(name);
      if (!points) {
        points = [];
        groups.set(name, points);
      }
      points.push([ts, v]);
    }
    return [...groups.entries()].map(([name, points], i) => ({
      name,
      data: points.toSorted((a, b) => a[0] - b[0]),
      color: spec.colors?.[i] ?? ChartPalette.categorical(i, dark),
    }));
  }
  const fields = spec.goalField ? [...spec.ys, spec.goalField] : spec.ys;
  return fields.map((field, i) => {
    const points = rows
      .map((row) => [parseTimestamp(row[spec.x]), toNumber(row[field])] as const)
      .filter(([ts, v]) => ts !== null && v !== null) as [number, number][];
    const color =
      field === spec.goalField
        ? ChartPalette.semantic("Neutral", dark)
        : (spec.colors?.[i] ?? ChartPalette.categorical(i, dark));
    return { name: field, data: points, color };
  });
}

function SeriesPicker({
  mode,
  options,
  value,
  onChange,
}: {
  mode: "select" | "combobox";
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (mode === "combobox") {
    return (
      <Combobox
        items={options}
        value={value}
        onValueChange={(v) => onChange(String(v))}
        size="sm"
      >
        <Combobox.TriggerInput aria-label="Series" placeholder="Search series…" />
        <Combobox.Content>
          <Combobox.List>
            {(item: string) => (
              <Combobox.Item key={item} value={item}>
                {item}
              </Combobox.Item>
            )}
          </Combobox.List>
          <Combobox.Empty>No series</Combobox.Empty>
        </Combobox.Content>
      </Combobox>
    );
  }
  return (
    <Select
      aria-label="Series"
      size="sm"
      value={value}
      onValueChange={(v) => onChange(String(v))}
    >
      {options.map((name) => (
        <Select.Option key={name} value={name}>
          {name}
        </Select.Option>
      ))}
    </Select>
  );
}

export function TimeseriesLine({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  const names = distinctSeries(spec, rows);
  const mode = pickerMode(spec, names.length);
  const [selected, setSelected] = useState(() => names[0] ?? "");

  if (rows.length === 0) return <ChartEmpty icon={<ChartLine size={24} weight="duotone" />} />;

  const active = mode === "none" ? undefined : names.includes(selected) ? selected : names[0];
  const format = (value: number) => formatValue(value, spec.format);
  const series = buildLineSeries(spec, rows, dark, active);
  const withTime = hasMeaningfulTime(series.flatMap((s) => s.data.map(([ts]) => ts)));
  return (
    <div className="w-full">
      {mode === "none" ? null : (
        <div className="mb-2 flex justify-end">
          <div className="w-48">
            <SeriesPicker
              mode={mode}
              options={names}
              value={active ?? ""}
              onChange={setSelected}
            />
          </div>
        </div>
      )}
      <TimeseriesChart
        echarts={echarts}
        data={series}
        gradient={spec.area}
        isDarkMode={dark}
        height={260}
        tooltipValueFormat={format}
        yAxisTickFormat={format}
        xAxisTickFormat={(ts) => formatAxisDate(ts, withTime)}
      />
      {series.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <ChartLegend.SmallItem
              key={s.name}
              name={s.name}
              color={s.color}
              value={format(s.data.at(-1)?.[1] ?? 0)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
