import type { Page } from "@openislands/schema";
import type { ActiveRange, ActiveSelect } from "./useIslandQuery.js";

/** The from/to bounds a page filter is currently set to (URL search params). */
export interface RangeBounds {
  from?: string;
  to?: string;
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
