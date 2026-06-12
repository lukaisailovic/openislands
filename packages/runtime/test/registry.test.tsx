import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BreakdownTreemap } from "../src/islands/BreakdownTreemap.js";
import { CategoryBar } from "../src/islands/CategoryBar.js";
import { CustomPlaceholder } from "../src/islands/CustomPlaceholder.js";
import { GaugeGoal } from "../src/islands/GaugeGoal.js";
import { GaugeRings } from "../src/islands/GaugeRings.js";
import { MetricKpi } from "../src/islands/MetricKpi.js";
import { NoteCard } from "../src/islands/NoteCard.js";
import { TableGrid } from "../src/islands/TableGrid.js";
import { TimeseriesLine } from "../src/islands/TimeseriesLine.js";
import { islandNeedsData, resolveRenderer } from "../src/islands/registry.js";

const goalGauge = (value: number) => (
  <GaugeGoal
    config={{ type: "gauge.goal", dataset: "macros", value: "kcal", goal: { min: "low", max: "high" }, label: "kcal", format: "int" }}
    data={{ dataset: "macros", columns: [], rows: [{ kcal: value, low: 2200, high: 2600 }] }}
  />
);

describe("island registry", () => {
  it("resolves ported built-in renderers", () => {
    expect(resolveRenderer("note.card")).toBe(NoteCard);
    expect(resolveRenderer("table.grid")).toBe(TableGrid);
  });

  it("resolves the chart renderers", () => {
    expect(resolveRenderer("metric.kpi")).toBe(MetricKpi);
    expect(resolveRenderer("timeseries.line")).toBe(TimeseriesLine);
    expect(resolveRenderer("breakdown.treemap")).toBe(BreakdownTreemap);
  });

  it("resolves the category.bar renderer", () => {
    expect(resolveRenderer("category.bar")).toBe(CategoryBar);
  });

  it("resolves the gauge.rings renderer", () => {
    expect(resolveRenderer("gauge.rings")).toBe(GaugeRings);
  });

  it("resolves the gauge.goal renderer", () => {
    expect(resolveRenderer("gauge.goal")).toBe(GaugeGoal);
  });

  it("resolves unknown custom types to the placeholder", () => {
    expect(resolveRenderer("gauge.ring")).toBe(CustomPlaceholder);
  });

  it("knows which islands need a data query", () => {
    expect(islandNeedsData("note.card")).toBe(false);
    expect(islandNeedsData("source.doc")).toBe(false);
    expect(islandNeedsData("table.grid")).toBe(true);
    expect(islandNeedsData("metric.kpi")).toBe(true);
    expect(islandNeedsData("gauge.rings")).toBe(true);
  });

  it("renders the placeholder naming the custom type", () => {
    render(<CustomPlaceholder config={{ type: "gauge.ring" }} />);
    expect(screen.getByText("Custom island")).toBeInTheDocument();
    expect(screen.getByText("gauge.ring").tagName).toBe("CODE");
  });

  it("renders labeled table headers from the manifest column spec", () => {
    render(
      <TableGrid
        config={{ type: "table.grid", dataset: "d", columns: [{ field: "name", label: "Name" }] }}
        data={{ dataset: "d", columns: [], rows: [{ name: "BTC" }] }}
      />,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("BTC")).toBeInTheDocument();
  });

  it("renders gauge.rings legend from the last row, resolving string and numeric maxes", () => {
    render(
      <GaugeRings
        config={{
          type: "gauge.rings",
          dataset: "macros",
          rings: [
            { value: "protein_g", max: "protein_goal_g", label: "Protein" },
            { value: "carb_g", max: 250 },
          ],
        }}
        data={{
          dataset: "macros",
          columns: [],
          rows: [
            { protein_g: 10, protein_goal_g: 180, carb_g: 1 },
            { protein_g: 120, protein_goal_g: 180, carb_g: 200 },
          ],
        }}
      />,
    );
    expect(screen.getByText("Protein")).toBeInTheDocument();
    expect(screen.getByText("120 / 180")).toBeInTheDocument();
    expect(screen.getByText("carb_g")).toBeInTheDocument();
    expect(screen.getByText("200 / 250")).toBeInTheDocument();
  });

  it("renders an over-budget atMost ring in a danger tone", () => {
    const { container } = render(
      <GaugeRings
        config={{
          type: "gauge.rings",
          dataset: "macros",
          rings: [{ value: "sat_fat_g", max: "sat_fat_limit_g", label: "Sat fat", direction: "atMost" }],
        }}
        data={{
          dataset: "macros",
          columns: [],
          rows: [{ sat_fat_g: 22, sat_fat_limit_g: 18 }],
        }}
      />,
    );
    expect(screen.getByText("22 / 18")).toBeInTheDocument();
    expect(container.querySelector('circle[stroke="#ff375f"]')).not.toBeNull();
  });

  it("keeps an under-budget atMost ring on its palette tone", () => {
    const { container } = render(
      <GaugeRings
        config={{
          type: "gauge.rings",
          dataset: "macros",
          rings: [{ value: "sat_fat_g", max: "sat_fat_limit_g", label: "Sat fat", direction: "atMost", color: "#34c759" }],
        }}
        data={{
          dataset: "macros",
          columns: [],
          rows: [{ sat_fat_g: 12, sat_fat_limit_g: 18 }],
        }}
      />,
    );
    expect(container.querySelector('circle[stroke="#ff375f"]')).toBeNull();
    expect(container.querySelector('circle[stroke="#34c759"]')).not.toBeNull();
  });

  it("renders gauge.goal within its band as success, off the last row", () => {
    render(goalGauge(2400));
    const gauge = screen.getByTestId("gauge-goal");
    expect(gauge.dataset.status).toBe("within");
    expect(screen.getByText("Within goal")).toBeInTheDocument();
    expect(screen.getByText("2,400")).toBeInTheDocument();
  });

  it("renders gauge.goal below the band as warning", () => {
    render(goalGauge(1800));
    expect(screen.getByTestId("gauge-goal").dataset.status).toBe("under");
    expect(screen.getByText("Under goal")).toBeInTheDocument();
  });

  it("renders gauge.goal above the band as danger", () => {
    render(goalGauge(3000));
    expect(screen.getByTestId("gauge-goal").dataset.status).toBe("over");
    expect(screen.getByText("Over goal")).toBeInTheDocument();
  });

  it("treats a single lower bound as satisfied at or above it", () => {
    render(
      <GaugeGoal
        config={{ type: "gauge.goal", dataset: "d", value: "v", goal: { min: "g" } }}
        data={{ dataset: "d", columns: [], rows: [{ v: 80, g: 100 }, { v: 120, g: 100 }] }}
      />,
    );
    expect(screen.getByTestId("gauge-goal").dataset.status).toBe("within");
  });

  it("renders note.card markdown", () => {
    render(<NoteCard config={{ type: "note.card", markdown: "# Heading\n\n- one\n- two" }} />);
    expect(screen.getByText("Heading")).toBeInTheDocument();
    expect(screen.getByText("one")).toBeInTheDocument();
  });
});
