import { describe, expect, it } from "vitest";
import { formatEvent } from "../src/server/events.js";

describe("SSE event payloads", () => {
  it("formats a datasets-changed frame", () => {
    const frame = formatEvent({ type: "datasets-changed", datasets: ["nw", "tx"] });
    expect(frame).toContain("event: datasets-changed");
    expect(frame).toContain('"datasets":["nw","tx"]');
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it("formats a validation frame carrying island errors", () => {
    const frame = formatEvent({
      type: "validation",
      islandErrors: [
        { page: "overview", index: 0, type: "metric.kpi", field: "value", message: "required" },
      ],
    });
    expect(frame).toContain("event: validation");
    expect(frame).toContain('"field":"value"');
  });
});
