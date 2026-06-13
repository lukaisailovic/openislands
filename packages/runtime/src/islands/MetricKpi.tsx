import { Badge, Chart, ChartPalette, type KumoChartOption, Text } from "@cloudflare/kumo";
import type { TimeseriesData } from "@cloudflare/kumo/components/chart";
import { TrendDown, TrendUp } from "@phosphor-icons/react";
import type { ValueFormat } from "@openislands/schema";
import type { Column, Row } from "@openislands/compiler";
import type { IslandRenderProps } from "../types.js";
import { formatAxisDate, hasMeaningfulTime, tooltip, usePrefersDark } from "./chart.js";
import { echarts } from "./echarts.js";
import { computeDelta, formatValue, toNumber } from "./format.js";
import { parseTimestamp } from "./TimeseriesLine.js";

const SPARK_HEIGHT = 150;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/**
 * The KPI's value series over its time axis, for the hoverable sparkline.
 * The time field is the first date-typed column, else the first string column
 * that parses as a timestamp. Without one there is no meaningful x-axis and
 * no sparkline. Pure, so tests assert without a DOM or ECharts.
 */
export function sparkSeries(
  rows: Row[],
  valueField: string,
  columns: Column[],
  color: string,
): TimeseriesData[] {
  const sample = rows.find((r) => r[valueField] != null) ?? {};
  const tsField =
    columns.find((c) => c.type === "date" && c.name !== valueField)?.name ??
    Object.keys(sample).find(
      (k) =>
        k !== valueField && typeof sample[k] === "string" && parseTimestamp(sample[k]) !== null,
    );
  if (!tsField) return [];
  const points = rows
    .map((row) => [parseTimestamp(row[tsField]), toNumber(row[valueField])] as const)
    .filter(([ts, v]) => ts !== null && v !== null) as [number, number][];
  if (points.length < 2) return [];
  return [{ name: valueField, data: points, color }];
}

function sparkOptions(
  spark: TimeseriesData,
  format: ValueFormat | undefined,
  dark: boolean,
): KumoChartOption {
  const labelColor = ChartPalette.text("secondary", dark);
  const withTime = hasMeaningfulTime(spark.data.map(([ts]) => ts));
  return {
    backgroundColor: "transparent",
    grid: { left: 0, right: 4, top: 8, bottom: 0, containLabel: true },
    tooltip: tooltip({
      trigger: "axis",
      dark,
      format,
      hideSeriesLabel: true,
      axisFormat: (value) => formatAxisDate(Number(value), withTime),
    }),
    xAxis: {
      type: "time",
      min: "dataMin",
      max: "dataMax",
      axisLine: { show: false },
      axisTick: { show: false },
      splitNumber: 3,
      axisLabel: {
        color: labelColor,
        hideOverlap: true,
        formatter: (value: number) => formatAxisDate(value, withTime),
      },
    },
    yAxis: {
      type: "value",
      splitNumber: 2,
      axisLabel: { color: labelColor, formatter: (value: number) => compact.format(value) },
    },
    series: [
      {
        type: "line",
        showSymbol: false,
        data: spark.data,
        lineStyle: { color: spark.color, width: 1.5 },
        itemStyle: { color: spark.color },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${spark.color}55` },
              { offset: 1, color: `${spark.color}00` },
            ],
          },
        },
      },
    ],
  };
}

function canRenderCanvas(): boolean {
  if (typeof document === "undefined") return false;
  return document.createElement("canvas").getContext("2d") !== null;
}

export function MetricKpi({ config, data }: IslandRenderProps) {
  const rows = data?.rows ?? [];
  const valueField = config.value as string;
  const format = config.format as ValueFormat | undefined;
  const dark = usePrefersDark();

  const last = rows.at(-1) ?? {};
  const display = formatValue(last[valueField] ?? null, format);
  const delta =
    config.compareTo === "prev" && rows.length > 1
      ? computeDelta(last[valueField] ?? null, rows.at(-2)?.[valueField] ?? null)
      : null;
  const spark = sparkSeries(
    rows,
    valueField,
    data?.columns ?? [],
    (config.color as string | undefined) ?? ChartPalette.categorical(0, dark),
  )[0];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2">
        <Text variant="heading3" as="span" className="font-medium tabular-nums tracking-tight">
          {display}
          {config.unit ? (
            <Text variant="secondary" size="sm" as="span" className="ml-1">
              {config.unit as string}
            </Text>
          ) : null}
        </Text>
        {delta ? (
          <div data-testid="kpi-delta" data-direction={delta.direction}>
            <Badge variant={delta.direction === "up" ? "success" : "destructive"}>
              {delta.direction === "up" ? <TrendUp size={12} /> : <TrendDown size={12} />}
              {Math.abs(delta.pct).toFixed(1)}%
            </Badge>
          </div>
        ) : null}
      </div>
      {spark && canRenderCanvas() ? (
        <div className="mt-2 flex-1">
          <Chart
            echarts={echarts}
            options={sparkOptions(spark, format, dark)}
            isDarkMode={dark}
            height={SPARK_HEIGHT}
          />
        </div>
      ) : null}
    </div>
  );
}
