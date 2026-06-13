import { describe, expect, it } from "vitest";
import { buildScorecardStats } from "../src/islands/MetricScorecard.js";

const rows = [
  { mrr_eur: 80_000, active_users: 1100, churn: 0.04, nps: 42 },
  { mrr_eur: 92_000, active_users: 1240, churn: 0.031, nps: 48 },
];

describe("metric.scorecard stat shaping", () => {
  it("reads each stat off the last row, formatting per its format", () => {
    const out = buildScorecardStats(
      {
        stats: [
          { value: "mrr_eur", label: "MRR", format: "eur" },
          { value: "active_users", label: "Active users", format: "int" },
        ],
      },
      rows,
    );
    expect(out.map((s) => s.display)).toEqual(["€92,000", "1,240"]);
    expect(out.map((s) => s.label)).toEqual(["MRR", "Active users"]);
  });

  it("falls back to the field name when no label is given", () => {
    const out = buildScorecardStats({ stats: [{ value: "nps" }] }, rows);
    expect(out[0]!.label).toBe("nps");
  });

  it("computes an up delta vs the previous row when compareTo is prev", () => {
    const out = buildScorecardStats(
      { stats: [{ value: "mrr_eur", compareTo: "prev" }] },
      rows,
    );
    expect(out[0]!.delta).toEqual({ pct: 15, direction: "up" });
  });

  it("computes a down delta for a decreasing value", () => {
    const out = buildScorecardStats(
      { stats: [{ value: "churn", compareTo: "prev" }] },
      rows,
    );
    expect(out[0]!.delta?.direction).toBe("down");
  });

  it("omits the delta when compareTo is none or absent", () => {
    const out = buildScorecardStats(
      {
        stats: [
          { value: "mrr_eur", compareTo: "none" },
          { value: "nps" },
        ],
      },
      rows,
    );
    expect(out.map((s) => s.delta)).toEqual([null, null]);
  });

  it("omits the delta when there is only one row", () => {
    const out = buildScorecardStats(
      { stats: [{ value: "mrr_eur", compareTo: "prev" }] },
      rows.slice(0, 1),
    );
    expect(out[0]!.delta).toBeNull();
  });

  it("carries the unit through and formats a missing field as an empty string", () => {
    const out = buildScorecardStats(
      { stats: [{ value: "missing", unit: "rpm" }] },
      rows,
    );
    expect(out[0]).toEqual({ label: "missing", display: "", unit: "rpm", delta: null });
  });

  it("returns an empty array when there are no stats", () => {
    expect(buildScorecardStats({ stats: [] }, rows)).toEqual([]);
  });
});
