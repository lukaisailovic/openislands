import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GaugeGoal } from "../src/islands/GaugeGoal.js";

const columns = [
  { name: "day", type: "date" },
  { name: "rhr", type: "number" },
] as const;

function renderGoal(configOverrides: Record<string, unknown>, value: number) {
  return render(
    <GaugeGoal
      config={{ type: "gauge.goal", dataset: "vitals", goals: [{ value: "rhr", goal: { min: 50, max: 60 } }], ...configOverrides }}
      data={{ dataset: "vitals", columns: [...columns], rows: [{ day: "2026-06-13", rhr: value }] }}
    />,
  );
}

function svgWidth(container: HTMLElement): number {
  const svg = container.querySelector("svg");
  return Number(svg?.getAttribute("width"));
}

describe("gauge.goal sizes", () => {
  it("renders at each size and exposes it via data-size", () => {
    for (const size of ["small", "medium", "large"] as const) {
      const { container } = renderGoal({ size }, 55);
      const root = within(container).getByTestId("gauge-goal");
      expect(root).toHaveAttribute("data-size", size);
      expect(container.querySelector("svg")).toBeInTheDocument();
    }
  });

  it("scales the rendered svg footprint small < medium < large", () => {
    const small = svgWidth(renderGoal({ size: "small" }, 55).container);
    const medium = svgWidth(renderGoal({ size: "medium" }, 55).container);
    const large = svgWidth(renderGoal({ size: "large" }, 55).container);
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
  });

  it("defaults to medium when size is omitted", () => {
    renderGoal({}, 55);
    expect(screen.getByTestId("gauge-goal")).toHaveAttribute("data-size", "medium");
  });
});

describe("gauge.goal status classification", () => {
  it("is within when the value sits inside the band", () => {
    renderGoal({ size: "medium" }, 55);
    expect(screen.getByTestId("gauge-goal-ring")).toHaveAttribute("data-status", "within");
  });

  it("is over when the value exceeds the max", () => {
    renderGoal({ size: "medium" }, 72);
    expect(screen.getByTestId("gauge-goal-ring")).toHaveAttribute("data-status", "over");
  });

  it("is under when the value falls below the min", () => {
    renderGoal({ size: "medium" }, 41);
    expect(screen.getByTestId("gauge-goal-ring")).toHaveAttribute("data-status", "under");
  });
});

describe("gauge.goal multiple goals", () => {
  it("renders one independently classified ring per goal", () => {
    render(
      <GaugeGoal
        config={{
          type: "gauge.goal",
          dataset: "vitals",
          goals: [
            { value: "rhr", goal: { min: 50, max: 60 } },
            { value: "spo2", goal: { max: 95 } },
          ],
        }}
        data={{ dataset: "vitals", columns: [...columns], rows: [{ day: "2026-06-13", rhr: 55, spo2: 99 }] }}
      />,
    );
    const rings = screen.getAllByTestId("gauge-goal-ring");
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveAttribute("data-status", "within");
    expect(rings[1]).toHaveAttribute("data-status", "over");
  });
});
