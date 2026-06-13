import { describe, expect, it } from "vitest";
import { BUILTIN_ISLAND_TYPES, validateManifest } from "@openislands/schema";
import { datasetNameFromFile, islandSkeleton, suggestIslands, type InferredColumn } from "../src/scaffold.js";

function manifestWithIsland(island: Record<string, unknown>) {
  return {
    version: 1,
    title: "T",
    datasets: { TODO: { source: "data/x.csv" } },
    pages: [{ id: "p", islands: [island] }],
  };
}

const num: InferredColumn = { name: "amount", type: "number" };
const num2: InferredColumn = { name: "fees", type: "number" };
const num3: InferredColumn = { name: "tax", type: "number" };
const num4: InferredColumn = { name: "tip", type: "number" };
const date: InferredColumn = { name: "day", type: "date" };
const str: InferredColumn = { name: "category", type: "string" };

describe("islandSkeleton", () => {
  it("has a skeleton for every built-in island type, each one valid as the sole island", () => {
    for (const type of BUILTIN_ISLAND_TYPES) {
      const skeleton = islandSkeleton(type);
      expect(skeleton.type).toBe(type);
      const v = validateManifest(manifestWithIsland(skeleton));
      expect(v.ok, `${type}: ${v.errors.map((e) => e.message).join("; ")}`).toBe(true);
    }
  });

  it("falls back to a generic skeleton for an unknown type", () => {
    expect(islandSkeleton("custom.thing")).toEqual({ type: "custom.thing", title: "New island" });
  });
});

describe("suggestIslands", () => {
  it("leads with a timeseries.line when there is a date and a number column", () => {
    const islands = suggestIslands("ds", [date, num]);
    const line = islands.find((i) => i.type === "timeseries.line");
    expect(line).toMatchObject({ dataset: "ds", x: "day", y: "amount" });
  });

  it("uses an array of up to three number columns for the line's y when several exist", () => {
    const line = suggestIslands("ds", [date, num, num2, num3, num4]).find((i) => i.type === "timeseries.line");
    expect(line!.y).toEqual(["amount", "fees", "tax"]);
  });

  it("includes both category.bar and breakdown.treemap when there is a string and a number column", () => {
    const types = suggestIslands("ds", [str, num]).map((i) => i.type);
    expect(types).toContain("category.bar");
    expect(types).toContain("breakdown.treemap");
  });

  it("suggests metric.kpi without compareTo when there is a number but no date", () => {
    const islands = suggestIslands("ds", [num]);
    const kpi = islands.find((i) => i.type === "metric.kpi");
    expect(kpi).toMatchObject({ value: "amount" });
    expect(kpi).not.toHaveProperty("compareTo");
    expect(islands.some((i) => i.type === "table.grid")).toBe(true);
  });

  it("adds compareTo: prev to metric.kpi when a date column is present", () => {
    const kpi = suggestIslands("ds", [date, num]).find((i) => i.type === "metric.kpi");
    expect(kpi).toMatchObject({ compareTo: "prev" });
  });

  it("never returns more than four islands, dropping table.grid when four higher-priority ones fill the cap", () => {
    const islands = suggestIslands("ds", [date, num, num2, str]);
    expect(islands.length).toBe(4);
    expect(islands.map((i) => i.type)).toEqual(["timeseries.line", "metric.kpi", "category.bar", "breakdown.treemap"]);
  });

  it("includes table.grid whenever fewer than four higher-priority islands are suggested", () => {
    expect(suggestIslands("ds", [date, num]).some((i) => i.type === "table.grid")).toBe(true);
    expect(suggestIslands("ds", [num]).some((i) => i.type === "table.grid")).toBe(true);
    expect(suggestIslands("ds", []).map((i) => i.type)).toEqual(["table.grid"]);
  });

  it("suggests only table.grid for a string-only schema", () => {
    expect(suggestIslands("ds", [str]).map((i) => i.type)).toEqual(["table.grid"]);
  });
});

describe("datasetNameFromFile", () => {
  it("derives a canonical name from a file path", () => {
    expect(datasetNameFromFile("Net Worth.csv")).toBe("net_worth");
    expect(datasetNameFromFile("data/2024-Q1.csv")).toBe("2024_q1");
    expect(datasetNameFromFile("weird!!name.json")).toBe("weird_name");
  });

  it("falls back to 'dataset' when the stem has no word characters", () => {
    expect(datasetNameFromFile("!!!.csv")).toBe("dataset");
  });
});
