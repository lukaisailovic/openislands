import { useEffect, useState } from "react";
import type { KumoChartOption } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import { formatValue } from "./format.js";

/** Tracks the OS color scheme on the client. Returns false during SSR. */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

/**
 * The raw ECharts `Chart` renders its tooltip as an absolutely positioned div
 * inside the chart container, which lives inside the card's `overflow-hidden`
 * surface — so the tooltip clips at the card edge. Anchoring it to `body`
 * lifts it out of every clipping ancestor; `confine` keeps it inside the
 * viewport. (`TimeseriesChart` sidesteps this with a Base UI portal tooltip,
 * so only the raw-`Chart` islands need this.) Stable locale keeps SSR and
 * client output identical.
 */
function tooltipSurface(dark: boolean): NonNullable<KumoChartOption["tooltip"]> {
  return {
    appendTo: () => (typeof document === "undefined" ? null : document.body),
    confine: true,
    backgroundColor: dark ? "#1f2430" : "#ffffff",
    borderColor: dark ? "#2f3645" : "#e5e7eb",
    borderWidth: 1,
    padding: [6, 10],
    textStyle: { color: dark ? "#e5e7eb" : "#1f2937", fontSize: 12 },
    extraCssText: "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.18);",
  };
}

export type TooltipTrigger = "item" | "axis";

/** ECharts decorates tooltip params with `axisValue` for axis-trigger tooltips; it is not in the base type. */
interface TooltipParam {
  marker?: unknown;
  seriesName?: string;
  name?: string;
  value?: unknown;
  axisValue?: unknown;
}

interface TooltipSpec {
  trigger: TooltipTrigger;
  dark: boolean;
  format?: ValueFormat;
  /** When set, the category/time axis value is rendered through this formatter. */
  axisFormat?: (value: unknown) => string;
  /** Drop the per-series swatch + name row — for single-series charts where the name carries no signal. */
  hideSeriesLabel?: boolean;
}

/**
 * A portal-anchored, Kumo-styled tooltip with formatted values and dates.
 * `dangerousHtmlFormatter` is fed only chart-internal strings we build here
 * (series names, formatted numbers), never raw user HTML.
 */
export function tooltip(spec: TooltipSpec): NonNullable<KumoChartOption["tooltip"]> {
  const value = (raw: unknown) => formatValue(raw as number, spec.format);
  return {
    ...tooltipSurface(spec.dark),
    trigger: spec.trigger,
    axisPointer: spec.trigger === "axis" ? { type: "shadow" } : undefined,
    dangerousHtmlFormatter: (params) => {
      const items = (Array.isArray(params) ? params : [params]) as TooltipParam[];
      if (items.length === 0) return "";
      const head = spec.axisFormat ? spec.axisFormat(items[0]?.axisValue) : undefined;
      const rows = items
        .map((p) => {
          const v = Array.isArray(p.value) ? p.value.at(-1) : p.value;
          if (spec.hideSeriesLabel) return tooltipRow("", undefined, value(v));
          const label = spec.trigger === "item" ? p.name : p.seriesName;
          return tooltipRow(String(p.marker ?? ""), label, value(v));
        })
        .join("");
      const header = head
        ? `<div style="margin-bottom:4px;font-weight:600;">${escapeHtml(head)}</div>`
        : "";
      return `${header}${rows}`;
    },
  };
}

function tooltipRow(marker: string, name: string | undefined, value: string): string {
  const valueCell = `<span style="font-weight:600;">${escapeHtml(value)}</span>`;
  if (!marker && !name) {
    return `<div style="line-height:1.6;">${valueCell}</div>`;
  }
  const label = name
    ? `<span style="margin-right:12px;">${marker}${escapeHtml(name)}</span>`
    : marker;
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;line-height:1.6;">${label}${valueCell}</div>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayYearFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const minuteFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/**
 * Human date for a time-axis value. Shows the time of day only when the data
 * carries a meaningful one (`withTime`), and the year only when it differs
 * from the current year. UTC keeps SSR and client output stable.
 */
export function formatAxisDate(ms: number, withTime: boolean): string {
  const d = new Date(ms);
  if (withTime) return minuteFmt.format(d);
  if (d.getUTCFullYear() === new Date().getUTCFullYear()) return dayFmt.format(d);
  return dayYearFmt.format(d);
}

/** True when any timestamp falls off a midnight boundary — i.e. time-of-day matters. */
export function hasMeaningfulTime(timestamps: number[]): boolean {
  return timestamps.some((ms) => ms % 86_400_000 !== 0);
}
