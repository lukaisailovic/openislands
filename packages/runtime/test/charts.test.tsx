import { describe, expect, it } from "vitest";
import {
  buildLineSeries,
  distinctSeries,
  parseTimestamp,
  pickerMode,
} from "../src/islands/TimeseriesLine.js";
import { buildBarData, isDateCategories } from "../src/islands/CategoryBar.js";
import { formatAxisDate, hasMeaningfulTime } from "../src/islands/chart.js";

const series = [
  { month: "2024-01", net_worth_eur: 100, other_eur: 10, target_eur: 120 },
  { month: "2024-02", net_worth_eur: 130, other_eur: 12, target_eur: 120 },
];

describe("timeseries date parsing", () => {
  it("parses YYYY-MM to the first of the month in epoch ms", () => {
    expect(parseTimestamp("2024-02")).toBe(Date.parse("2024-02-01"));
  });

  it("parses YYYY-MM-DD", () => {
    expect(parseTimestamp("2024-02-15")).toBe(Date.parse("2024-02-15"));
  });

  it("parses ISO weeks to the Monday of that week", () => {
    expect(parseTimestamp("2026-W18")).toBe(Date.parse("2026-04-27"));
    expect(parseTimestamp("2024-W01")).toBe(Date.parse("2024-01-01"));
  });

  it("passes through Date and number values", () => {
    const d = new Date("2024-03-01");
    expect(parseTimestamp(d)).toBe(d.getTime());
    expect(parseTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("returns null for unparseable values", () => {
    expect(parseTimestamp("not-a-date")).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
  });
});

describe("timeseries.line series shaping", () => {
  it("produces one series per y for a string y", () => {
    const out = buildLineSeries({ x: "month", ys: ["net_worth_eur"], area: false }, series, false);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("net_worth_eur");
    expect(out[0]!.data).toEqual([
      [Date.parse("2024-01-01"), 100],
      [Date.parse("2024-02-01"), 130],
    ]);
  });

  it("produces one series per y for an array y", () => {
    const out = buildLineSeries(
      { x: "month", ys: ["net_worth_eur", "other_eur"], area: false },
      series,
      false,
    );
    expect(out.map((s) => s.name)).toEqual(["net_worth_eur", "other_eur"]);
  });

  it("appends the goal field as an extra series", () => {
    const out = buildLineSeries(
      { x: "month", ys: ["net_worth_eur"], goalField: "target_eur", area: false },
      series,
      false,
    );
    expect(out.map((s) => s.name)).toEqual(["net_worth_eur", "target_eur"]);
  });

  it("splits long-format rows into one series per series-field value, time-sorted", () => {
    const out = buildLineSeries(
      { x: "date", ys: ["value"], series: "marker", area: false },
      [
        { date: "2024-02-01", marker: "ApoB", value: 90 },
        { date: "2024-01-01", marker: "ApoB", value: 96 },
        { date: "2024-01-01", marker: "hs-CRP", value: 1.6 },
      ],
      false,
    );
    expect(out.map((s) => s.name)).toEqual(["ApoB", "hs-CRP"]);
    expect(out[0]!.data).toEqual([
      [Date.parse("2024-01-01"), 96],
      [Date.parse("2024-02-01"), 90],
    ]);
  });

  it("uses configured colors per y field, leaving the goal line neutral", () => {
    const out = buildLineSeries(
      {
        x: "month",
        ys: ["net_worth_eur", "other_eur"],
        goalField: "target_eur",
        colors: ["#ff0000", "#00ff00"],
        area: false,
      },
      series,
      false,
    );
    expect(out[0]!.color).toBe("#ff0000");
    expect(out[1]!.color).toBe("#00ff00");
    expect(out[2]!.color).not.toBe("#ff0000");
  });

  it("uses configured colors per series value, falling back to the palette when exhausted", () => {
    const out = buildLineSeries(
      { x: "date", ys: ["value"], series: "marker", colors: ["#ff0000"], area: false },
      [
        { date: "2024-01-01", marker: "ApoB", value: 96 },
        { date: "2024-01-01", marker: "hs-CRP", value: 1.6 },
      ],
      false,
    );
    expect(out[0]!.color).toBe("#ff0000");
    expect(out[1]!.color).not.toBe("#ff0000");
  });

  it("drops points whose value or timestamp is not finite", () => {
    const out = buildLineSeries(
      { x: "month", ys: ["net_worth_eur"], area: false },
      [
        { month: "2024-01", net_worth_eur: 100 },
        { month: "bad", net_worth_eur: 50 },
        { month: "2024-03", net_worth_eur: null },
      ],
      false,
    );
    expect(out[0]!.data).toEqual([[Date.parse("2024-01-01"), 100]]);
  });
});

const markers = (n: number) =>
  Array.from({ length: n }, (_, i) => [
    { draw_date: "2024-01-01", name: `m${i}`, value: i },
    { draw_date: "2024-02-01", name: `m${i}`, value: i + 1 },
  ]).flat();

describe("timeseries.line series picker scaling", () => {
  const spec = { x: "draw_date", ys: ["value"], series: "name", area: false };

  it("lists distinct series values in first-seen data order", () => {
    expect(distinctSeries(spec, markers(3))).toEqual(["m0", "m1", "m2"]);
  });

  it("skips series whose only rows have a non-numeric y when listing values", () => {
    const rows = [
      { draw_date: "2024-01-01", name: "GFR", value: ">60" },
      { draw_date: "2024-01-01", name: "LDL", value: 100 },
    ];
    expect(distinctSeries(spec, rows)).toEqual(["LDL"]);
  });

  it("renders all series (no picker) at or below eight distinct values", () => {
    expect(pickerMode(spec, distinctSeries(spec, markers(8)).length)).toBe("none");
  });

  it("auto-picks a Select above eight and a Combobox above fifteen", () => {
    expect(pickerMode(spec, 9)).toBe("select");
    expect(pickerMode(spec, 24)).toBe("combobox");
  });

  it("respects seriesPicker overrides", () => {
    expect(pickerMode({ ...spec, seriesPicker: true }, 3)).toBe("select");
    expect(pickerMode({ ...spec, seriesPicker: false }, 60)).toBe("none");
  });

  it("never picks without a series field", () => {
    expect(pickerMode({ x: "x", ys: ["y"], area: false }, 99)).toBe("none");
  });

  it("shapes only the selected series when one is picked", () => {
    const out = buildLineSeries(spec, markers(3), false, "m1");
    expect(out.map((s) => s.name)).toEqual(["m1"]);
    expect(out[0]!.data).toEqual([
      [Date.parse("2024-01-01"), 1],
      [Date.parse("2024-02-01"), 2],
    ]);
  });
});

const bars = [
  { service: "api", p95_ms: 120, region: "eu" },
  { service: "web", p95_ms: 80, region: "eu" },
  { service: "api", p95_ms: 200, region: "us" },
  { service: "web", p95_ms: 90, region: "us" },
];

describe("axis date formatting", () => {
  it("formats a date with no meaningful time as month + day", () => {
    expect(formatAxisDate(Date.parse("2026-05-28T00:00:00Z"), false)).toBe("May 28");
  });

  it("includes the year when it is not the current year", () => {
    expect(formatAxisDate(Date.parse("2019-05-28T00:00:00Z"), false)).toBe("May 28, 2019");
  });

  it("adds a 24-hour time when time is meaningful", () => {
    expect(formatAxisDate(Date.parse("2026-05-28T02:00:00Z"), true)).toBe("May 28, 02:00");
  });

  it("detects time-of-day only when a timestamp is off the midnight boundary", () => {
    expect(hasMeaningfulTime([Date.parse("2026-05-28T00:00:00Z")])).toBe(false);
    expect(
      hasMeaningfulTime([
        Date.parse("2026-05-28T00:00:00Z"),
        Date.parse("2026-05-28T02:00:00Z"),
      ]),
    ).toBe(true);
  });
});

describe("category.bar data shaping", () => {
  it("builds one series per y over distinct x categories", () => {
    const out = buildBarData({ x: "service", ys: ["p95_ms"], stacked: false }, bars.slice(0, 2));
    expect(out.categories).toEqual(["api", "web"]);
    expect(out.series).toEqual([{ name: "p95_ms", data: [120, 80] }]);
  });

  it("pivots a group field into one series per group value", () => {
    const out = buildBarData(
      { x: "service", ys: ["p95_ms"], group: "region", stacked: false },
      bars,
    );
    expect(out.categories).toEqual(["api", "web"]);
    expect(out.series).toEqual([
      { name: "eu", data: [120, 80] },
      { name: "us", data: [200, 90] },
    ]);
  });

  it("fills missing category/group combinations with zero", () => {
    const out = buildBarData({ x: "service", ys: ["p95_ms"], group: "region", stacked: false }, [
      { service: "api", p95_ms: 120, region: "eu" },
      { service: "web", p95_ms: 90, region: "us" },
    ]);
    const eu = out.series.find((s) => s.name === "eu");
    const us = out.series.find((s) => s.name === "us");
    expect(eu!.data).toEqual([120, 0]);
    expect(us!.data).toEqual([0, 90]);
  });

  it("treats an axis as dates only when every category is an ISO date", () => {
    expect(isDateCategories(["2026-05-10", "2026-05-11"])).toBe(true);
    expect(isDateCategories(["2026-05-10 23:15:00", "2026-05-11T08:00:00"])).toBe(true);
    expect(isDateCategories(["2026-05-10", "api"])).toBe(false);
    expect(isDateCategories(["2026-05", "2026-06"])).toBe(false);
    expect(isDateCategories([])).toBe(false);
  });
});
