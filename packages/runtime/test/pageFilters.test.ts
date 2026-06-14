import { describe, expect, it } from "vitest";
import { type Page, validateManifest } from "@openislands/schema";
import { activeRanges, activeSelects } from "../src/client/pageFilters.js";

function pageWithFilters(filters: unknown[]): Page {
  const result = validateManifest({
    version: 1,
    title: "T",
    datasets: {
      services: { source: "data/services.csv" },
      services_health: { source: "data/services.csv" },
    },
    pages: [{ id: "p", layout: "grid", filters, islands: [{ type: "note.card", markdown: "x" }] }],
  });
  if (!result.manifest) throw new Error(`invalid manifest fixture: ${result.errors[0]?.message}`);
  return result.manifest.pages[0]!;
}

describe("activeSelects", () => {
  it("maps each bound dataset to {field, values} for a chosen select filter", () => {
    const page = pageWithFilters([
      { id: "team", type: "select", multiple: true, bind: { services: "owner", services_health: "owner" } },
    ]);
    const selects = activeSelects(page, { team: ["platform", "data"] });
    expect(selects.get("services")).toEqual({ field: "owner", values: ["platform", "data"] });
    expect(selects.get("services_health")).toEqual({ field: "owner", values: ["platform", "data"] });
  });

  it("returns an empty map when the filter has no chosen values", () => {
    const page = pageWithFilters([{ id: "team", type: "select", bind: { services: "owner" } }]);
    expect(activeSelects(page, {}).size).toBe(0);
    expect(activeSelects(page, { team: [] }).size).toBe(0);
  });

  it("ignores non-select filters", () => {
    const page = pageWithFilters([{ id: "period", type: "daterange", bind: { services: "day" } }]);
    expect(activeSelects(page, { period: ["x"] }).size).toBe(0);
  });

  it("is empty when a page declares no filters", () => {
    const page = pageWithFilters([]);
    expect(activeSelects(page, { team: ["platform"] }).size).toBe(0);
  });
});

describe("activeRanges", () => {
  it("maps each bound dataset to {field, from, to} when a bound is set", () => {
    const page = pageWithFilters([{ id: "period", type: "daterange", bind: { services: "day" } }]);
    const ranges = activeRanges(page, { from: "2026-01-01", to: "2026-02-01" });
    expect(ranges.get("services")).toEqual({ field: "day", from: "2026-01-01", to: "2026-02-01" });
  });

  it("is empty when no bound is set", () => {
    const page = pageWithFilters([{ id: "period", type: "daterange", bind: { services: "day" } }]);
    expect(activeRanges(page, {}).size).toBe(0);
  });
});
