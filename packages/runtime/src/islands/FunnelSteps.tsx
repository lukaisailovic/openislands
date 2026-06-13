import { Chart, ChartPalette, type KumoChartOption } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { tooltip, usePrefersDark } from "./chart.js";
import { echarts } from "./echarts.js";
import { formatValue } from "./format.js";

type FunnelSort = "none" | "ascending" | "descending";

interface FunnelSpec {
  label: string;
  value: string;
  sort: FunnelSort;
  colors?: string[];
  format?: ValueFormat;
}

export interface FunnelStage {
  name: string;
  value: number;
}

function readSpec(config: IslandRenderProps["config"]): FunnelSpec {
  return {
    label: config.label as string,
    value: config.value as string,
    sort: (config.sort as FunnelSort | undefined) ?? "none",
    colors: config.colors as string[] | undefined,
    format: config.format as ValueFormat | undefined,
  };
}

/**
 * Shape rows into ECharts funnel stages: label -> name, value -> number.
 * Drops non-finite or negative counts and keeps row order — ECharts reorders
 * the stages itself via the series `sort` option. Pure, so tests assert without
 * a DOM or ECharts.
 */
export function buildFunnelData(spec: FunnelSpec, rows: Row[]): FunnelStage[] {
  return rows
    .map((r) => ({ name: String(r[spec.label] ?? ""), value: Number(r[spec.value] ?? 0) }))
    .filter((stage) => Number.isFinite(stage.value) && stage.value >= 0);
}

function buildOptions(spec: FunnelSpec, rows: Row[], dark: boolean): KumoChartOption {
  const stages = buildFunnelData(spec, rows);
  return {
    backgroundColor: "transparent",
    tooltip: tooltip({ trigger: "item", dark, format: spec.format }),
    color: spec.colors?.length
      ? spec.colors
      : stages.map((_, i) => ChartPalette.categorical(i, dark)),
    series: [
      {
        type: "funnel",
        sort: spec.sort,
        gap: 2,
        left: "10%",
        right: "10%",
        top: 10,
        bottom: 10,
        minSize: "0%",
        maxSize: "100%",
        label: {
          show: true,
          position: "inside",
          color: "#fff",
          formatter: (p: { name?: string; value?: unknown }) =>
            `${p.name ?? ""}: ${formatValue(p.value as number, spec.format)}`,
        },
        itemStyle: { borderColor: "transparent", borderWidth: 1 },
        data: stages,
      },
    ],
  };
}

export function FunnelSteps({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  if (rows.length === 0) return <NoData />;

  return (
    <div className="w-full">
      <Chart
        echarts={echarts}
        options={buildOptions(spec, rows, dark)}
        isDarkMode={dark}
        height={260}
      />
    </div>
  );
}
