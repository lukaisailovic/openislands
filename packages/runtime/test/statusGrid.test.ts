import { describe, expect, it } from "vitest";
import { buildStatusTiles, toneFor } from "../src/islands/StatusGrid.js";

describe("status.grid toneFor", () => {
  it("maps the success keywords to success", () => {
    for (const state of ["up", "ok", "healthy", "online", "success", "operational"]) {
      expect(toneFor(state)).toBe("success");
    }
  });

  it("maps the warning keywords to warning", () => {
    for (const state of ["warn", "warning", "degraded", "pending"]) {
      expect(toneFor(state)).toBe("warning");
    }
  });

  it("maps the danger keywords to danger", () => {
    for (const state of ["down", "error", "critical", "fail", "failed", "offline"]) {
      expect(toneFor(state)).toBe("danger");
    }
  });

  it("falls back to neutral for an unknown state", () => {
    expect(toneFor("maintenance")).toBe("neutral");
  });

  it("matches keywords case-insensitively and trimmed", () => {
    expect(toneFor("  DEGRADED ")).toBe("warning");
    expect(toneFor("Down")).toBe("danger");
  });

  it("lets an explicit tones override win over the keyword convention", () => {
    expect(toneFor("degraded", { degraded: "danger" })).toBe("danger");
    expect(toneFor("maintenance", { maintenance: "warning" })).toBe("warning");
  });
});

describe("status.grid buildStatusTiles", () => {
  const rows = [
    { service: "gateway", status: "degraded", latency_ms: 340 },
    { service: "auth", status: "healthy", latency_ms: 90 },
    { service: "payments", status: "down", latency_ms: 0 },
  ];

  it("builds one tile per row with the tone resolved from its state", () => {
    const tiles = buildStatusTiles({ label: "service", state: "status" }, rows);
    expect(tiles).toEqual([
      { label: "gateway", state: "degraded", value: null, tone: "warning" },
      { label: "auth", state: "healthy", value: null, tone: "success" },
      { label: "payments", state: "down", value: null, tone: "danger" },
    ]);
  });

  it("formats the value when a value field is configured", () => {
    const tiles = buildStatusTiles({ label: "service", state: "status", value: "latency_ms", format: "int" }, rows);
    expect(tiles.map((t) => t.value)).toEqual(["340", "90", "0"]);
  });

  it("applies a tones override per tile", () => {
    const tiles = buildStatusTiles({ label: "service", state: "status", tones: { degraded: "danger" } }, rows);
    expect(tiles[0]!.tone).toBe("danger");
  });

  it("coerces a missing label to an empty name and a missing state to neutral", () => {
    const tiles = buildStatusTiles({ label: "service", state: "status" }, [{ latency_ms: 5 }]);
    expect(tiles).toEqual([{ label: "", state: "", value: null, tone: "neutral" }]);
  });

  it("returns an empty array for empty input", () => {
    expect(buildStatusTiles({ label: "service", state: "status" }, [])).toEqual([]);
  });
});
