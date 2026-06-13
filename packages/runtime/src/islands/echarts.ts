import * as echarts from "echarts/core";
import {
  BarChart,
  FunnelChart,
  HeatmapChart,
  LineChart,
  MapChart,
  PieChart,
  RadarChart,
  ScatterChart,
  TreemapChart,
} from "echarts/charts";
import {
  BrushComponent,
  CalendarComponent,
  GeoComponent,
  GridComponent,
  LegendComponent,
  RadarComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  TreemapChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  FunnelChart,
  RadarChart,
  MapChart,
  GridComponent,
  TooltipComponent,
  BrushComponent,
  ToolboxComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
  RadarComponent,
  GeoComponent,
  CanvasRenderer,
]);

export { echarts };
