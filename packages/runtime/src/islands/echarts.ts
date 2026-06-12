import * as echarts from "echarts/core";
import { BarChart, LineChart, TreemapChart } from "echarts/charts";
import {
  BrushComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  TreemapChart,
  GridComponent,
  TooltipComponent,
  BrushComponent,
  ToolboxComponent,
  LegendComponent,
  CanvasRenderer,
]);

export { echarts };
