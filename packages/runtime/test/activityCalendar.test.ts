import { describe, expect, it } from "vitest";
import { buildCalendarData } from "../src/islands/ActivityCalendar.js";

const spec = { date: "day", value: "count" };

describe("activity.calendar data shaping", () => {
  it("maps rows to [UTC YYYY-MM-DD, value] points, sorted by day", () => {
    const out = buildCalendarData(spec, [
      { day: "2026-03-02", count: 5 },
      { day: "2026-03-01", count: 3 },
    ]);
    expect(out.points).toEqual([
      ["2026-03-01", 3],
      ["2026-03-02", 5],
    ]);
  });

  it("sums multiple rows that land on the same calendar day", () => {
    const out = buildCalendarData(spec, [
      { day: "2026-03-01", count: 3 },
      { day: "2026-03-01", count: 4 },
    ]);
    expect(out.points).toEqual([["2026-03-01", 7]]);
  });

  it("buckets ISO and epoch-ms timestamps into their UTC calendar day", () => {
    const out = buildCalendarData(spec, [
      { day: "2026-03-01T18:30:00Z", count: 2 },
      { day: "2026-03-02T00:00:00Z", count: 9 },
      { day: Date.parse("2026-03-01T05:00:00Z"), count: 1 },
    ]);
    expect(out.points).toEqual([
      ["2026-03-01", 3],
      ["2026-03-02", 9],
    ]);
  });

  it("drops rows with unparseable dates or non-finite values", () => {
    const out = buildCalendarData(spec, [
      { day: "2026-03-01", count: 5 },
      { day: "not-a-date", count: 4 },
      { day: "2026-03-02", count: null },
      { day: "2026-03-03", count: "nope" },
    ]);
    expect(out.points).toEqual([["2026-03-01", 5]]);
  });

  it("reports the date range as the [earliest, latest] day and the value extent", () => {
    const out = buildCalendarData(spec, [
      { day: "2026-03-10", count: 8 },
      { day: "2026-03-01", count: 2 },
      { day: "2026-03-05", count: 5 },
    ]);
    expect(out.range).toEqual(["2026-03-01", "2026-03-10"]);
    expect(out.min).toBe(2);
    expect(out.max).toBe(8);
  });

  it("handles empty input gracefully", () => {
    expect(buildCalendarData(spec, [])).toEqual({
      points: [],
      range: ["", ""],
      min: 0,
      max: 0,
    });
  });

  it("returns empty data when every row is dropped", () => {
    const out = buildCalendarData(spec, [{ day: "bad", count: 1 }]);
    expect(out.points).toEqual([]);
    expect(out.range).toEqual(["", ""]);
  });
});
