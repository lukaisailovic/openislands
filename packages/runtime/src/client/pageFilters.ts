import type { Page } from "@openislands/schema";
import type { ActiveRange, ActiveSelect } from "./useIslandQuery.js";

/** The from/to bounds a page filter is currently set to (URL search params). */
export interface RangeBounds {
  from?: string;
  to?: string;
}

export type PeriodPreset = "today" | "last-7-days" | "last-30-days" | "last-90-days" | "this-month" | "last-month";

export const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "last-7-days", label: "Last 7 days" },
  { key: "last-30-days", label: "Last 30 days" },
  { key: "last-90-days", label: "Last 90 days" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
];

const pad = (n: number) => String(n).padStart(2, "0");

export function toDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(today: Date, days: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
}

export function presetBounds(preset: PeriodPreset, today: Date): Required<RangeBounds> {
  const span = (from: Date, to: Date) => ({ from: toDay(from), to: toDay(to) });
  switch (preset) {
    case "today":
      return span(today, today);
    case "last-7-days":
      return span(daysAgo(today, 6), today);
    case "last-30-days":
      return span(daysAgo(today, 29), today);
    case "last-90-days":
      return span(daysAgo(today, 89), today);
    case "this-month":
      return span(new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 0));
    case "last-month":
      return span(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0));
  }
}

/**
 * Resolve the initial range for a page from the first `daterange` filter that
 * declares a `default` preset, evaluated against `today` so it tracks the
 * current date. Returns an empty bounds (all-time) when no filter sets a default.
 */
export function defaultRangeBounds(page: Page, today: Date): RangeBounds {
  for (const filter of page.filters ?? []) {
    if (filter.type !== "daterange") continue;
    if (filter.default === undefined) continue;
    return presetBounds(filter.default, today);
  }
  return {};
}

/**
 * Resolve the active range per dataset for a page. A dataset gets a range when
 * a daterange filter binds it and at least one bound is set; the bound column
 * is the filter's `bind[dataset]`. Returns an empty map when nothing is active,
 * so islands query unfiltered.
 */
export function activeRanges(page: Page, bounds: RangeBounds): Map<string, ActiveRange> {
  const ranges = new Map<string, ActiveRange>();
  if (bounds.from === undefined && bounds.to === undefined) return ranges;
  for (const filter of page.filters ?? []) {
    if (filter.type !== "daterange") continue;
    for (const [dataset, field] of Object.entries(filter.bind)) {
      ranges.set(dataset, { field, from: bounds.from, to: bounds.to });
    }
  }
  return ranges;
}

/**
 * Resolve the active select narrowing per dataset for a page. A dataset gets a
 * narrowing when a select filter binds it and the user has chosen values; the
 * bound column is the filter's `bind[dataset]`. Returns an empty map when
 * nothing is chosen, so islands query unfiltered.
 */
export function activeSelects(page: Page, chosen: Record<string, string[]>): Map<string, ActiveSelect> {
  const selects = new Map<string, ActiveSelect>();
  for (const filter of page.filters ?? []) {
    if (filter.type !== "select") continue;
    const values = chosen[filter.id];
    if (!values || values.length === 0) continue;
    for (const [dataset, field] of Object.entries(filter.bind)) {
      selects.set(dataset, { field, values });
    }
  }
  return selects;
}
