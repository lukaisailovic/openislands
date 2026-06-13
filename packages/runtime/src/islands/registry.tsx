import type { ComponentType } from "react";
import type { IslandType } from "@openislands/schema";
import type { IslandRenderProps } from "../types.js";
import { setDrilldownResolver } from "./drilldownRenderer.js";
import { BreakdownTreemap } from "./BreakdownTreemap.js";
import { CategoryBar } from "./CategoryBar.js";
import { CategoryPie } from "./CategoryPie.js";
import { CustomPlaceholder } from "./CustomPlaceholder.js";
import { GaugeGoal } from "./GaugeGoal.js";
import { GaugeMeter } from "./GaugeMeter.js";
import { GaugeRings } from "./GaugeRings.js";
import { MetricKpi } from "./MetricKpi.js";
import { NoteCard } from "./NoteCard.js";
import { SearchBox } from "./SearchBox.js";
import { SourceDoc } from "./SourceDoc.js";
import { TableGrid } from "./TableGrid.js";
import { TimelineFeed } from "./TimelineFeed.js";
import { TimeseriesLine } from "./TimeseriesLine.js";

export type IslandRenderer = ComponentType<IslandRenderProps>;

/** A `null` slot is a built-in island with no renderer yet; it falls back to the placeholder. */
const REGISTRY: Record<IslandType, IslandRenderer | null> = {
  "note.card": NoteCard,
  "source.doc": SourceDoc,
  "table.grid": TableGrid,
  "timeline.feed": TimelineFeed,
  "metric.kpi": MetricKpi,
  "timeseries.line": TimeseriesLine,
  "category.bar": CategoryBar,
  "category.pie": CategoryPie,
  "breakdown.treemap": BreakdownTreemap,
  "gauge.rings": GaugeRings,
  "gauge.goal": GaugeGoal,
  "gauge.meter": GaugeMeter,
  "search.box": SearchBox,
};

export function registerIsland(type: IslandType, renderer: IslandRenderer): void {
  REGISTRY[type] = renderer;
}

/** Resolve a renderer for any island type; unknown and unimplemented fall back to the placeholder. */
export function resolveRenderer(type: string): IslandRenderer {
  if (type in REGISTRY) return REGISTRY[type as IslandType] ?? CustomPlaceholder;
  return CustomPlaceholder;
}

setDrilldownResolver(resolveRenderer);

/** Islands that bind to a dataset need a client query; data-free ones (note/source) don't. */
export function islandNeedsData(type: string): boolean {
  return type !== "note.card" && type !== "source.doc";
}
