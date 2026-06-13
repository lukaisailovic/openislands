import { describe, expect, it } from "vitest";
import { buildPieData } from "../src/islands/CategoryPie.js";

const spec = { label: "category", value: "spend" };

describe("category.pie data shaping", () => {
  it("maps rows to {name,value} sorted descending by value", () => {
    expect(
      buildPieData(spec, [
        { category: "Ads", spend: 30 },
        { category: "Payroll", spend: 90 },
        { category: "Travel", spend: 50 },
      ]),
    ).toEqual([
      { name: "Payroll", value: 90 },
      { name: "Travel", value: 50 },
      { name: "Ads", value: 30 },
    ]);
  });

  it("sums duplicate labels into a single slice", () => {
    expect(
      buildPieData(spec, [
        { category: "Ads", spend: 30 },
        { category: "Ads", spend: 20 },
        { category: "Payroll", spend: 40 },
      ]),
    ).toEqual([
      { name: "Ads", value: 50 },
      { name: "Payroll", value: 40 },
    ]);
  });

  it("drops non-finite and non-positive values", () => {
    expect(
      buildPieData(spec, [
        { category: "A", spend: 3 },
        { category: "B", spend: 0 },
        { category: "C", spend: -5 },
        { category: "D", spend: Number.NaN },
        { category: "E", spend: Number.POSITIVE_INFINITY },
      ]),
    ).toEqual([{ name: "A", value: 3 }]);
  });

  it("coerces numeric strings and skips rows whose value is non-numeric", () => {
    expect(
      buildPieData(spec, [
        { category: "A", spend: "12" },
        { category: "B", spend: "n/a" },
      ]),
    ).toEqual([{ name: "A", value: 12 }]);
  });

  it("treats a missing label field as the empty-string slice", () => {
    expect(buildPieData(spec, [{ spend: 7 }])).toEqual([{ name: "", value: 7 }]);
  });

  it("returns an empty array for empty input", () => {
    expect(buildPieData(spec, [])).toEqual([]);
  });
});
