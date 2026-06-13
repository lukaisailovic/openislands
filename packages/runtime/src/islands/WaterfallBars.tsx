import { Chart, type KumoChartOption, ChartPalette } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { echarts } from "./echarts.js";
import { formatValue, toNumber } from "./format.js";
import { tooltip, usePrefersDark } from "./chart.js";

type WaterfallTone = "increase" | "decrease" | "total";

interface WaterfallToneColors {
  increase?: string;
  decrease?: string;
  total?: string;
}

interface WaterfallSpec {
  label: string;
  value: string;
  kind?: string;
  colors?: WaterfallToneColors;
  format?: ValueFormat;
}

export interface WaterfallBar {
  label: string;
  base: number;
  visible: number;
  signed: number;
  tone: WaterfallTone;
}

const TONE_DEFAULTS: Record<WaterfallTone, string> = {
  increase: "#34c759",
  decrease: "#ff375f",
  total: "#8e8e93",
};

function readSpec(config: IslandRenderProps["config"]): WaterfallSpec {
  return {
    label: config.label as string,
    value: config.value as string,
    kind: config.kind as string | undefined,
    colors: config.colors as WaterfallToneColors | undefined,
    format: config.format as ValueFormat | undefined,
  };
}

/** Walk rows into floating bars: deltas stack on a running total; a `total` row resets the running total and draws from zero. Pure, so tests assert without ECharts. */
export function buildWaterfall(spec: WaterfallSpec, rows: Row[]): WaterfallBar[] {
  let running = 0;
  return rows.map((row) => {
    const label = String(row[spec.label] ?? "");
    const signed = toNumber(row[spec.value]) ?? 0;
    const isTotal = spec.kind ? String(row[spec.kind] ?? "") === "total" : false;
    if (isTotal) {
      running = signed;
      return { label, base: 0, visible: signed, signed, tone: "total" };
    }
    if (signed >= 0) {
      const bar: WaterfallBar = { label, base: running, visible: signed, signed, tone: "increase" };
      running += signed;
      return bar;
    }
    running += signed;
    return { label, base: running, visible: -signed, signed, tone: "decrease" };
  });
}

function toneColor(colors: WaterfallToneColors | undefined, tone: WaterfallTone): string {
  return colors?.[tone] ?? TONE_DEFAULTS[tone];
}

function buildOptions(spec: WaterfallSpec, bars: WaterfallBar[], dark: boolean): KumoChartOption {
  const axisLabelColor = ChartPalette.text("secondary", dark);
  return {
    backgroundColor: "transparent",
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      ...tooltip({ trigger: "item", dark, format: spec.format, hideSeriesLabel: true }),
      dangerousHtmlFormatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const i = (item as { dataIndex?: number } | undefined)?.dataIndex;
        const bar = i === undefined ? undefined : bars[i];
        if (!bar) return "";
        return `<div style="line-height:1.6;"><span style="margin-right:12px;">${bar.label}</span><span style="font-weight:600;">${formatValue(bar.signed, spec.format)}</span></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: bars.map((bar) => bar.label),
      axisLabel: { color: axisLabelColor, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: axisLabelColor, formatter: (value: number) => formatValue(value, spec.format) },
    },
    series: [
      {
        type: "bar",
        stack: "waterfall",
        silent: true,
        itemStyle: { color: "transparent" },
        data: bars.map((bar) => bar.base),
      },
      {
        type: "bar",
        stack: "waterfall",
        data: bars.map((bar) => ({ value: bar.visible, itemStyle: { color: toneColor(spec.colors, bar.tone) } })),
      },
    ],
  };
}

export function WaterfallBars({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  const dark = usePrefersDark();

  if (rows.length === 0) return <NoData />;

  const bars = buildWaterfall(spec, rows);
  return (
    <div className="w-full">
      <Chart echarts={echarts} options={buildOptions(spec, bars, dark)} isDarkMode={dark} height={260} />
    </div>
  );
}
