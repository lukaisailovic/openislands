import { describe, expect, it } from "vitest";
import { bucketColor, buildDivergenceBars } from "../src/islands/DivergenceBars.js";

describe("divergence.bars color buckets", () => {
  const buckets = [
    { gte: 300, color: "green-high" },
    { gte: 0, lt: 300, color: "green-low" },
    { gte: -500, lt: 0, color: "red-low" },
    { lt: -500, color: "red-high" },
  ];

  it("matches the first band whose half-open [gte, lt) range contains the value", () => {
    expect(bucketColor(500, buckets)).toBe("green-high");
    expect(bucketColor(100, buckets)).toBe("green-low");
    expect(bucketColor(-200, buckets)).toBe("red-low");
    expect(bucketColor(-900, buckets)).toBe("red-high");
  });

  it("treats gte as inclusive and lt as exclusive at a band boundary", () => {
    expect(bucketColor(0, buckets)).toBe("green-low");
    expect(bucketColor(300, buckets)).toBe("green-high");
    expect(bucketColor(-500, buckets)).toBe("red-low");
  });

  it("falls back to neutral grey when no band matches", () => {
    expect(bucketColor(50, [{ gte: 100, color: "x" }])).toBe("#8e8e93");
  });

  it("colors bars by the default two-tone and skips rows whose value isn't a number", () => {
    const twoTone = [{ gte: 0, color: "#34c759" }, { lt: 0, color: "#ff375f" }];
    expect(
      buildDivergenceBars({ x: "day", value: "delta", buckets: twoTone }, [
        { day: "Mon", delta: 120 },
        { day: "Tue", delta: -80 },
        { day: "Wed", delta: 0 },
        { day: "Thu" },
        { day: "Fri", delta: "n/a" },
      ]),
    ).toEqual([
      { category: "Mon", value: 120, color: "#34c759" },
      { category: "Tue", value: -80, color: "#ff375f" },
      { category: "Wed", value: 0, color: "#34c759" },
    ]);
  });
});
