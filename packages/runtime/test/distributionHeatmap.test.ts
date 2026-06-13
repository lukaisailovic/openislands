import { describe, expect, it } from "vitest";
import { buildHeatmapData } from "../src/islands/DistributionHeatmap.js";

const spec = { x: "hour", y: "day", value: "count" };

describe("distribution.heatmap data shaping", () => {
  it("pivots rows into an x × y matrix with first-seen category order", () => {
    const out = buildHeatmapData(spec, [
      { hour: "9", day: "Mon", count: 3 },
      { hour: "10", day: "Mon", count: 5 },
      { hour: "9", day: "Tue", count: 2 },
    ]);
    expect(out.xs).toEqual(["9", "10"]);
    expect(out.ys).toEqual(["Mon", "Tue"]);
    expect(out.cells).toEqual([
      [0, 0, 3],
      [1, 0, 5],
      [0, 1, 2],
    ]);
  });

  it("lets the last value win for a repeated (x, y) cell", () => {
    const out = buildHeatmapData(spec, [
      { hour: "9", day: "Mon", count: 3 },
      { hour: "9", day: "Mon", count: 8 },
    ]);
    expect(out.cells).toEqual([[0, 0, 8]]);
  });

  it("reports min and max over the cell values", () => {
    const out = buildHeatmapData(spec, [
      { hour: "9", day: "Mon", count: 3 },
      { hour: "10", day: "Mon", count: 5 },
      { hour: "9", day: "Tue", count: -1 },
    ]);
    expect(out.min).toBe(-1);
    expect(out.max).toBe(5);
  });

  it("drops rows whose value is non-finite and excludes their categories", () => {
    const out = buildHeatmapData(spec, [
      { hour: "9", day: "Mon", count: 3 },
      { hour: "11", day: "Wed", count: null },
      { hour: "12", day: "Thu", count: "n/a" },
    ]);
    expect(out.xs).toEqual(["9"]);
    expect(out.ys).toEqual(["Mon"]);
    expect(out.cells).toEqual([[0, 0, 3]]);
  });

  it("coerces missing category fields to an empty-string label", () => {
    const out = buildHeatmapData(spec, [{ count: 4 }]);
    expect(out.xs).toEqual([""]);
    expect(out.ys).toEqual([""]);
    expect(out.cells).toEqual([[0, 0, 4]]);
  });

  it("returns a zero extent for empty input", () => {
    const out = buildHeatmapData(spec, []);
    expect(out).toEqual({ xs: [], ys: [], cells: [], min: 0, max: 0 });
  });
});
