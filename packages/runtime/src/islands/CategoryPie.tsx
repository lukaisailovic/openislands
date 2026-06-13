import { Chart, ChartPalette, type KumoChartOption } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { tooltip, usePrefersDark } from "./chart.js";
import { echarts } from "./echarts.js";

interface PieSpec {
  label: string;
  value: string;
  donut: boolean;
  colors?: string[];
  format?: ValueFormat;
}

export interface PieSlice {
  name: string;
  value: number;
}

function readSpec(config: IslandRenderProps["config"]): PieSpec {
  return {
    label: config.label as string,
    value: config.value as string,
    donut: config.donut === true,
    colors: config.colors as string[] | undefined,
    format: config.format as ValueFormat | undefined,
  };
}

/**
 * Shape rows into pie slices: SUM by label, drop non-finite/non-positive
 * values, sort descending by value. Pure, so tests assert without a DOM or
 * ECharts.
 */
export function buildPieData(spec: Pick<PieSpec, "label" | "value">, rows: Row[]): PieSlice[] {
  const byLabel = new Map<string, number>();
  for (const row of rows) {
    const value = Number(row[spec.value]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const name = String(row[spec.label] ?? "");
    byLabel.set(name, (byLabel.get(name) ?? 0) + value);
  }
  return [...byLabel]
    .map(([name, value]) => ({ name, value }))
    .toSorted((a, b) => b.value - a.value);
}

function sliceColor(spec: PieSpec, i: number, dark: boolean): string {
  return spec.colors?.[i] ?? ChartPalette.categorical(i, dark);
}

function buildOptions(spec: PieSpec, slices: PieSlice[], dark: boolean): KumoChartOption {
  const labelColor = ChartPalette.text("secondary", dark);
  const scroll = slices.length > 8;
  return {
    backgroundColor: "transparent",
    tooltip: tooltip({ trigger: "item", dark, format: spec.format }),
    legend: {
      type: scroll ? "scroll" : "plain",
      orient: "horizontal",
      bottom: 0,
      icon: "circle",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: labelColor, fontSize: 12 },
      pageTextStyle: { color: labelColor },
    },
    series: [
      {
        type: "pie",
        radius: spec.donut ? ["45%", "72%"] : "72%",
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        label: { color: labelColor, fontSize: 12, formatter: "{d}%" },
        labelLine: { length: 8, length2: 8, lineStyle: { color: labelColor, opacity: 0.4 } },
        itemStyle: { borderColor: dark ? "#1f2430" : "#ffffff", borderWidth: 2 },
        data: slices.map((slice, i) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: { color: sliceColor(spec, i, dark) },
        })),
      },
    ],
  };
}

export function CategoryPie({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  if (rows.length === 0) return <NoData />;

  return (
    <div className="w-full">
      <Chart
        echarts={echarts}
        options={buildOptions(spec, buildPieData(spec, rows), dark)}
        isDarkMode={dark}
        height={260}
      />
    </div>
  );
}
