import { describe, expect, it } from "vitest";
import { buildScatterSeries, scaleSize } from "../src/islands/CorrelationScatter.js";

const rows = [
  { spend: 1000, conversions: 40, channel: "search", customers: 30 },
  { spend: 2200, conversions: 95, channel: "social", customers: 60 },
  { spend: 1500, conversions: 70, channel: "search", customers: 45 },
];

describe("correlation.scatter series shaping", () => {
  it("maps rows to a single [x, y] series when no series field is set", () => {
    const out = buildScatterSeries({ x: "spend", y: "conversions" }, rows, false);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("conversions");
    expect(out[0]!.data).toEqual([
      [1000, 40],
      [2200, 95],
      [1500, 70],
    ]);
  });

  it("groups points into one series per distinct series value in first-seen order", () => {
    const out = buildScatterSeries({ x: "spend", y: "conversions", series: "channel" }, rows, false);
    expect(out.map((s) => s.name)).toEqual(["search", "social"]);
    expect(out[0]!.data).toEqual([
      [1000, 40],
      [1500, 70],
    ]);
    expect(out[1]!.data).toEqual([[2200, 95]]);
  });

  it("appends the size value and label to each point when configured", () => {
    const out = buildScatterSeries(
      { x: "spend", y: "conversions", size: "customers", label: "channel" },
      rows.slice(0, 1),
      false,
    );
    expect(out[0]!.data).toEqual([[1000, 40, 30, "search"]]);
  });

  it("drops rows whose x or y is non-finite or non-numeric", () => {
    const out = buildScatterSeries(
      { x: "spend", y: "conversions" },
      [
        { spend: 1000, conversions: 40 },
        { spend: "n/a", conversions: 50 },
        { spend: 1500, conversions: null },
        { spend: Infinity, conversions: 60 },
      ],
      false,
    );
    expect(out[0]!.data).toEqual([[1000, 40]]);
  });

  it("uses configured colors per series, falling back to the palette when exhausted", () => {
    const out = buildScatterSeries(
      { x: "spend", y: "conversions", series: "channel", colors: ["#ff0000"] },
      rows,
      false,
    );
    expect(out[0]!.color).toBe("#ff0000");
    expect(out[1]!.color).not.toBe("#ff0000");
  });

  it("returns an empty single series for empty input", () => {
    const out = buildScatterSeries({ x: "spend", y: "conversions" }, [], false);
    expect(out).toEqual([{ name: "conversions", data: [], color: expect.any(String) }]);
  });
});

describe("correlation.scatter bubble sizing", () => {
  it("maps the min and max size values to the radius range bounds", () => {
    expect(scaleSize(10, 10, 50)).toBe(8);
    expect(scaleSize(50, 10, 50)).toBe(38);
    expect(scaleSize(30, 10, 50)).toBe(23);
  });

  it("collapses a degenerate spread to the midpoint radius", () => {
    expect(scaleSize(42, 42, 42)).toBe(23);
  });
});
