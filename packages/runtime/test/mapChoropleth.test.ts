import { describe, expect, it } from "vitest";
import { buildChoroplethData } from "../src/islands/MapChoropleth.js";

const spec = { region: "country", value: "revenue", map: "world" };

describe("map.choropleth data shaping", () => {
  it("maps rows to {name,value} with the value extent", () => {
    expect(
      buildChoroplethData(spec, [
        { country: "France", revenue: 30 },
        { country: "Japan", revenue: 50 },
      ]),
    ).toEqual({
      items: [
        { name: "France", value: 30 },
        { name: "Japan", value: 50 },
      ],
      min: 30,
      max: 50,
    });
  });

  it("sums duplicate regions into a single item", () => {
    const out = buildChoroplethData(spec, [
      { country: "Germany", revenue: 10 },
      { country: "Germany", revenue: 15 },
      { country: "Brazil", revenue: 7 },
    ]);
    expect(out.items).toEqual([
      { name: "Germany", value: 25 },
      { name: "Brazil", value: 7 },
    ]);
    expect(out).toMatchObject({ min: 7, max: 25 });
  });

  it("drops rows with a non-finite value or an empty region", () => {
    const out = buildChoroplethData(spec, [
      { country: "India", revenue: 12 },
      { country: "Spain", revenue: "n/a" },
      { country: "", revenue: 99 },
      { country: "Italy", revenue: null },
    ]);
    expect(out.items).toEqual([{ name: "India", value: 12 }]);
  });

  it("handles negative values in the extent", () => {
    const out = buildChoroplethData(spec, [
      { country: "Chile", revenue: -5 },
      { country: "Peru", revenue: 20 },
    ]);
    expect(out).toMatchObject({ min: -5, max: 20 });
  });

  it("returns an empty extent of 0,0 when no rows survive", () => {
    expect(buildChoroplethData(spec, [])).toEqual({ items: [], min: 0, max: 0 });
    expect(buildChoroplethData(spec, [{ country: "", revenue: "x" }])).toEqual({
      items: [],
      min: 0,
      max: 0,
    });
  });
});
