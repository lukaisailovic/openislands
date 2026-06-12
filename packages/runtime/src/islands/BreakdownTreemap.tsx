import { Chart, ChartPalette, type KumoChartOption } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { tooltip, usePrefersDark } from "./chart.js";
import { echarts } from "./echarts.js";

interface TreemapSpec {
  label: string;
  value: string;
  parent?: string;
  colors?: string[];
  format?: ValueFormat;
}

export interface TreemapNode {
  name: string;
  value: number;
  children?: TreemapNode[];
}

function readSpec(config: IslandRenderProps["config"]): TreemapSpec {
  return {
    label: config.label as string,
    value: config.value as string,
    parent: config.parent as string | undefined,
    colors: config.colors as string[] | undefined,
    format: config.format as ValueFormat | undefined,
  };
}

/** Shape rows into ECharts treemap data. Pure, so tests assert without a DOM or ECharts. */
export function buildTreemapData(spec: TreemapSpec, rows: Row[]): TreemapNode[] {
  const leaves = rows
    .map((r) => ({
      name: String(r[spec.label] ?? ""),
      value: Number(r[spec.value] ?? 0),
      parent: spec.parent ? String(r[spec.parent] ?? "") : undefined,
    }))
    .filter((n) => Number.isFinite(n.value) && n.value > 0);

  if (!spec.parent) return leaves.map(({ name, value }) => ({ name, value }));

  const byParent = new Map<string, TreemapNode>();
  const roots: TreemapNode[] = [];
  for (const leaf of leaves) {
    const parentName = leaf.parent ?? "";
    if (parentName === "") {
      roots.push({ name: leaf.name, value: leaf.value });
      continue;
    }
    let parent = byParent.get(parentName);
    if (!parent) {
      parent = { name: parentName, value: 0, children: [] };
      byParent.set(parentName, parent);
      roots.push(parent);
    }
    parent.children!.push({ name: leaf.name, value: leaf.value });
    parent.value += leaf.value;
  }
  return roots;
}

function buildOptions(spec: TreemapSpec, rows: Row[], dark: boolean): KumoChartOption {
  return {
    backgroundColor: "transparent",
    tooltip: tooltip({ trigger: "item", dark, format: spec.format }),
    color: spec.colors?.length
      ? spec.colors
      : Array.from({ length: 6 }, (_, i) => ChartPalette.categorical(i, dark)),
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: { color: "#fff", fontSize: 12 },
        itemStyle: { borderColor: "transparent", borderWidth: 2, gapWidth: 2 },
        data: buildTreemapData(spec, rows),
      },
    ],
  };
}

export function BreakdownTreemap({ config, data }: IslandRenderProps) {
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
