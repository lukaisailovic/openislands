import { type ComponentType, lazy } from "react";
import type { IslandType } from "@openislands/schema";
import type { IslandRenderProps } from "../types.js";
import { setDrilldownResolver } from "./drilldownRenderer.js";
import { CustomPlaceholder } from "./CustomPlaceholder.js";

export type IslandRenderer = ComponentType<IslandRenderProps>;

/**
 * Wrap a renderer module behind {@link lazy} so it lands in its own chunk.
 * The islands carry the bulk of the runtime's weight — echarts (every chart
 * island), Lexical (`content.editor`), the world map (`map.choropleth`) — and a
 * static import of this registry used to drag all of it into every caller's
 * bundle. Loading on demand means a page downloads only the renderers it mounts;
 * every render site already sits behind a Suspense boundary for the gap.
 */
function lazyIsland<Module, Name extends keyof Module>(
  load: () => Promise<Module>,
  name: Name,
): IslandRenderer {
  return lazy(async () => ({ default: (await load())[name] as IslandRenderer }));
}

/** A `null` slot is a built-in island with no renderer yet; it falls back to the placeholder. */
const REGISTRY: Record<IslandType, IslandRenderer | null> = {
  "note.card": lazyIsland(() => import("./NoteCard.js"), "NoteCard"),
  "source.doc": lazyIsland(() => import("./SourceDoc.js"), "SourceDoc"),
  "table.grid": lazyIsland(() => import("./TableGrid.js"), "TableGrid"),
  "timeline.feed": lazyIsland(() => import("./TimelineFeed.js"), "TimelineFeed"),
  "metric.kpi": lazyIsland(() => import("./MetricKpi.js"), "MetricKpi"),
  "metric.scorecard": lazyIsland(() => import("./MetricScorecard.js"), "MetricScorecard"),
  "timeseries.line": lazyIsland(() => import("./TimeseriesLine.js"), "TimeseriesLine"),
  "category.bar": lazyIsland(() => import("./CategoryBar.js"), "CategoryBar"),
  "category.combo": lazyIsland(() => import("./CategoryCombo.js"), "CategoryCombo"),
  "waterfall.bars": lazyIsland(() => import("./WaterfallBars.js"), "WaterfallBars"),
  "divergence.bars": lazyIsland(() => import("./DivergenceBars.js"), "DivergenceBars"),
  "category.pie": lazyIsland(() => import("./CategoryPie.js"), "CategoryPie"),
  "correlation.scatter": lazyIsland(() => import("./CorrelationScatter.js"), "CorrelationScatter"),
  "breakdown.treemap": lazyIsland(() => import("./BreakdownTreemap.js"), "BreakdownTreemap"),
  "distribution.heatmap": lazyIsland(() => import("./DistributionHeatmap.js"), "DistributionHeatmap"),
  "activity.calendar": lazyIsland(() => import("./ActivityCalendar.js"), "ActivityCalendar"),
  "funnel.steps": lazyIsland(() => import("./FunnelSteps.js"), "FunnelSteps"),
  "rank.list": lazyIsland(() => import("./RankList.js"), "RankList"),
  "compare.radar": lazyIsland(() => import("./CompareRadar.js"), "CompareRadar"),
  "map.choropleth": lazyIsland(() => import("./MapChoropleth.js"), "MapChoropleth"),
  "gauge.rings": lazyIsland(() => import("./GaugeRings.js"), "GaugeRings"),
  "gauge.goal": lazyIsland(() => import("./GaugeGoal.js"), "GaugeGoal"),
  "gauge.meter": lazyIsland(() => import("./GaugeMeter.js"), "GaugeMeter"),
  "status.grid": lazyIsland(() => import("./StatusGrid.js"), "StatusGrid"),
  "search.box": lazyIsland(() => import("./SearchBox.js"), "SearchBox"),
  "content.editor": lazyIsland(() => import("./ContentEditor.js"), "ContentEditor"),
  "form.entry": lazyIsland(() => import("./FormEntry.js"), "FormEntry"),
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

/**
 * Islands that bind to a dataset need a client query. Data-free ones (note/source)
 * don't, `content.editor` manages its own file fetching, and `form.entry` fetches
 * its action's schema instead of a dataset.
 */
export function islandNeedsData(type: string): boolean {
  return (
    type !== "note.card" && type !== "source.doc" && type !== "content.editor" && type !== "form.entry"
  );
}
