import type { ComponentType } from "react";
import type { IslandType } from "@openislands/schema";
import type { IslandRenderProps } from "../types.js";
import { setDrilldownResolver } from "./drilldownRenderer.js";
import { ActivityCalendar } from "./ActivityCalendar.js";
import { BreakdownTreemap } from "./BreakdownTreemap.js";
import { CategoryBar } from "./CategoryBar.js";
import { CategoryCombo } from "./CategoryCombo.js";
import { CategoryPie } from "./CategoryPie.js";
import { CompareRadar } from "./CompareRadar.js";
import { ContentEditor } from "./ContentEditor.js";
import { CorrelationScatter } from "./CorrelationScatter.js";
import { CustomPlaceholder } from "./CustomPlaceholder.js";
import { DistributionHeatmap } from "./DistributionHeatmap.js";
import { FunnelSteps } from "./FunnelSteps.js";
import { GaugeGoal } from "./GaugeGoal.js";
import { GaugeMeter } from "./GaugeMeter.js";
import { GaugeRings } from "./GaugeRings.js";
import { MapChoropleth } from "./MapChoropleth.js";
import { MetricKpi } from "./MetricKpi.js";
import { MetricScorecard } from "./MetricScorecard.js";
import { NoteCard } from "./NoteCard.js";
import { RankList } from "./RankList.js";
import { SearchBox } from "./SearchBox.js";
import { SourceDoc } from "./SourceDoc.js";
import { StatusGrid } from "./StatusGrid.js";
import { TableGrid } from "./TableGrid.js";
import { TimelineFeed } from "./TimelineFeed.js";
import { TimeseriesLine } from "./TimeseriesLine.js";
import { WaterfallBars } from "./WaterfallBars.js";

export type IslandRenderer = ComponentType<IslandRenderProps>;

/** A `null` slot is a built-in island with no renderer yet; it falls back to the placeholder. */
const REGISTRY: Record<IslandType, IslandRenderer | null> = {
  "note.card": NoteCard,
  "source.doc": SourceDoc,
  "table.grid": TableGrid,
  "timeline.feed": TimelineFeed,
  "metric.kpi": MetricKpi,
  "metric.scorecard": MetricScorecard,
  "timeseries.line": TimeseriesLine,
  "category.bar": CategoryBar,
  "category.combo": CategoryCombo,
  "waterfall.bars": WaterfallBars,
  "category.pie": CategoryPie,
  "correlation.scatter": CorrelationScatter,
  "breakdown.treemap": BreakdownTreemap,
  "distribution.heatmap": DistributionHeatmap,
  "activity.calendar": ActivityCalendar,
  "funnel.steps": FunnelSteps,
  "rank.list": RankList,
  "compare.radar": CompareRadar,
  "map.choropleth": MapChoropleth,
  "gauge.rings": GaugeRings,
  "gauge.goal": GaugeGoal,
  "gauge.meter": GaugeMeter,
  "status.grid": StatusGrid,
  "search.box": SearchBox,
  "content.editor": ContentEditor,
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
 * don't, and `content.editor` manages its own file fetching.
 */
export function islandNeedsData(type: string): boolean {
  return type !== "note.card" && type !== "source.doc" && type !== "content.editor";
}
