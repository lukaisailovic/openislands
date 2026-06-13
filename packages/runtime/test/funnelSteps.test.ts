import { describe, expect, it } from "vitest";
import { buildFunnelData } from "../src/islands/FunnelSteps.js";

const spec = { label: "stage", value: "count", sort: "none" as const };

const stages = [
  { stage: "Visitors", count: 48_200 },
  { stage: "Signups", count: 9_400 },
  { stage: "Activated", count: 5_100 },
  { stage: "Trials", count: 2_300 },
  { stage: "Paid", count: 870 },
];

describe("funnel.steps data shaping", () => {
  it("maps label->name and value->number, preserving row order", () => {
    expect(buildFunnelData(spec, stages)).toEqual([
      { name: "Visitors", value: 48_200 },
      { name: "Signups", value: 9_400 },
      { name: "Activated", value: 5_100 },
      { name: "Trials", value: 2_300 },
      { name: "Paid", value: 870 },
    ]);
  });

  it("keeps a zero-count stage (>= 0) but drops negative ones", () => {
    expect(
      buildFunnelData(spec, [
        { stage: "A", count: 10 },
        { stage: "B", count: 0 },
        { stage: "C", count: -3 },
      ]),
    ).toEqual([
      { name: "A", value: 10 },
      { name: "B", value: 0 },
    ]);
  });

  it("drops a non-numeric value but treats a missing value as zero", () => {
    expect(
      buildFunnelData(spec, [
        { stage: "A", count: 5 },
        { stage: "B", count: "n/a" },
        { stage: "C" },
      ]),
    ).toEqual([
      { name: "A", value: 5 },
      { name: "C", value: 0 },
    ]);
  });

  it("coerces a numeric string value and a missing label to an empty name", () => {
    expect(buildFunnelData(spec, [{ count: "12" }])).toEqual([{ name: "", value: 12 }]);
  });

  it("returns an empty array for empty input", () => {
    expect(buildFunnelData(spec, [])).toEqual([]);
  });
});
