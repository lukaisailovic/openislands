import { describe, expect, it } from "vitest";
import { buildWaterfall } from "../src/islands/WaterfallBars.js";

const spec = { label: "step", value: "delta", kind: "kind" };

describe("waterfall.bars data shaping", () => {
  it("walks totals from zero and accumulates signed deltas on the running total", () => {
    const rows = [
      { step: "Opening", delta: 100, kind: "total" },
      { step: "Revenue", delta: 50, kind: "delta" },
      { step: "Costs", delta: -30, kind: "delta" },
      { step: "Closing", delta: 120, kind: "total" },
    ];
    expect(buildWaterfall(spec, rows)).toEqual([
      { label: "Opening", base: 0, visible: 100, signed: 100, tone: "total" },
      { label: "Revenue", base: 100, visible: 50, signed: 50, tone: "increase" },
      { label: "Costs", base: 120, visible: 30, signed: -30, tone: "decrease" },
      { label: "Closing", base: 0, visible: 120, signed: 120, tone: "total" },
    ]);
  });

  it("treats every row as a delta when kind is omitted (no total anchors)", () => {
    const noKind = { label: "step", value: "delta" };
    expect(
      buildWaterfall(noKind, [
        { step: "A", delta: 40, kind: "total" },
        { step: "B", delta: 25 },
        { step: "C", delta: -15 },
      ]),
    ).toEqual([
      { label: "A", base: 0, visible: 40, signed: 40, tone: "increase" },
      { label: "B", base: 40, visible: 25, signed: 25, tone: "increase" },
      { label: "C", base: 50, visible: 15, signed: -15, tone: "decrease" },
    ]);
  });

  it("floats a leading decrease below zero", () => {
    expect(
      buildWaterfall(spec, [
        { step: "Drop", delta: -20, kind: "delta" },
        { step: "Recover", delta: 30, kind: "delta" },
      ]),
    ).toEqual([
      { label: "Drop", base: -20, visible: 20, signed: -20, tone: "decrease" },
      { label: "Recover", base: -20, visible: 30, signed: 30, tone: "increase" },
    ]);
  });

  it("coerces a non-numeric or missing value to zero", () => {
    expect(
      buildWaterfall(spec, [
        { step: "Start", delta: 10, kind: "total" },
        { step: "Bad", delta: "n/a", kind: "delta" },
        { step: "Missing", kind: "delta" },
      ]),
    ).toEqual([
      { label: "Start", base: 0, visible: 10, signed: 10, tone: "total" },
      { label: "Bad", base: 10, visible: 0, signed: 0, tone: "increase" },
      { label: "Missing", base: 10, visible: 0, signed: 0, tone: "increase" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(buildWaterfall(spec, [])).toEqual([]);
  });
});
