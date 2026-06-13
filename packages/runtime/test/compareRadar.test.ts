import { describe, expect, it } from "vitest";
import { buildRadarData } from "../src/islands/CompareRadar.js";

const products = [
  { product: "Aurora", performance: 82, price: 60, design: 90 },
  { product: "Borealis", performance: 74, price: 88, design: 70 },
];

describe("compare.radar data shaping", () => {
  it("builds one indicator per metric and one polygon per row", () => {
    const out = buildRadarData({ metrics: ["performance", "price", "design"], series: "product" }, products);
    expect(out.indicators.map((indicator) => indicator.name)).toEqual([
      "performance",
      "price",
      "design",
    ]);
    expect(out.series.map((polygon) => polygon.name)).toEqual(["Aurora", "Borealis"]);
    expect(out.series[0]!.value).toEqual([82, 60, 90]);
  });

  it("names polygons Series N when no series field is given", () => {
    const out = buildRadarData({ metrics: ["performance", "price", "design"] }, products);
    expect(out.series.map((polygon) => polygon.name)).toEqual(["Series 1", "Series 2"]);
  });

  it("uses a fixed max for every axis when configured", () => {
    const out = buildRadarData({ metrics: ["performance", "price"], max: 100 }, products);
    expect(out.indicators).toEqual([
      { name: "performance", max: 100 },
      { name: "price", max: 100 },
    ]);
  });

  it("derives each axis max from its metric's peak, rounded up with headroom", () => {
    const out = buildRadarData({ metrics: ["performance", "price"] }, products);
    expect(out.indicators[0]!.max).toBe(100);
    expect(out.indicators[1]!.max).toBe(100);
    const small = buildRadarData({ metrics: ["score"] }, [{ score: 3 }, { score: 7 }]);
    expect(small.indicators[0]!.max).toBe(10);
  });

  it("falls back to a max of 1 when every value on an axis is zero or missing", () => {
    const out = buildRadarData({ metrics: ["latency"] }, [{ latency: 0 }, {}]);
    expect(out.indicators[0]!.max).toBe(1);
  });

  it("maps missing and non-numeric metric values to 0", () => {
    const out = buildRadarData({ metrics: ["a", "b", "c"], series: "name" }, [
      { name: "X", a: 5, b: "n/a", c: null },
    ]);
    expect(out.series[0]!.value).toEqual([5, 0, 0]);
  });

  it("returns no indicators or series for empty input", () => {
    const out = buildRadarData({ metrics: ["a"] }, []);
    expect(out.series).toEqual([]);
    expect(out.indicators).toEqual([{ name: "a", max: 1 }]);
  });
});
