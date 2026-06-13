import { describe, expect, it } from "vitest";
import { buildRankItems } from "../src/islands/RankList.js";

const spec = { label: "name", value: "revenue", limit: 10, sort: "descending" as const };

const products = [
  { name: "Alpha", revenue: 400 },
  { name: "Bravo", revenue: 100 },
  { name: "Charlie", revenue: 800 },
  { name: "Delta", revenue: 200 },
];

describe("rank.list data shaping", () => {
  it("ranks rows by value descending and sizes each bar against the peak", () => {
    expect(buildRankItems(spec, products)).toEqual([
      { label: "Charlie", value: 800, secondary: undefined, pct: 100 },
      { label: "Alpha", value: 400, secondary: undefined, pct: 50 },
      { label: "Delta", value: 200, secondary: undefined, pct: 25 },
      { label: "Bravo", value: 100, secondary: undefined, pct: 12.5 },
    ]);
  });

  it("ranks ascending when sort is ascending", () => {
    expect(buildRankItems({ ...spec, sort: "ascending" }, products).map((r) => r.label)).toEqual([
      "Bravo",
      "Delta",
      "Alpha",
      "Charlie",
    ]);
  });

  it("keeps only the top-N rows", () => {
    const items = buildRankItems({ ...spec, limit: 2 }, products);
    expect(items.map((r) => r.label)).toEqual(["Charlie", "Alpha"]);
    expect(items[0]!.pct).toBe(100);
  });

  it("reads the secondary field when configured", () => {
    const items = buildRankItems(
      { ...spec, secondary: "region", limit: 1 },
      [{ name: "Alpha", revenue: 400, region: "EU" }],
    );
    expect(items).toEqual([{ label: "Alpha", value: 400, secondary: "EU", pct: 100 }]);
  });

  it("coerces missing or non-numeric values to zero and a missing label to an empty name", () => {
    expect(buildRankItems(spec, [{ revenue: "n/a" }])).toEqual([
      { label: "", value: 0, secondary: undefined, pct: 0 },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(buildRankItems(spec, [])).toEqual([]);
  });
});
