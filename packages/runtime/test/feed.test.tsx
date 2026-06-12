import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { TimelineFeed } from "../src/islands/TimelineFeed.js";
import "../src/islands/registry.js";

afterEach(() => vi.restoreAllMocks());

function withClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const meals = [
  {
    meal_id: 1,
    name: "Greek yogurt bowl",
    kcal: 280,
    protein_g: 13.7,
    carbs_g: 17,
    fat_g: 16.5,
    meal_type: "breakfast",
    ts: "2026-06-11 08:15:00",
  },
];

const richConfig = {
  type: "timeline.feed",
  dataset: "meals",
  ts: "ts",
  titleField: "name",
  highlight: { field: "kcal", unit: "kcal" },
  stats: [
    { field: "protein_g", label: "P", format: "int" as const, unit: "g" },
    { field: "carbs_g", label: "C", format: "int" as const, unit: "g" },
    { field: "fat_g", label: "F", format: "int" as const, unit: "g" },
  ],
  footer: [{ field: "meal_type", pill: true }],
};

describe("timeline.feed rich rows", () => {
  it("renders title, highlight value + unit, stats, a footer pill, and the timestamp", () => {
    render(<TimelineFeed config={richConfig} data={{ dataset: "meals", columns: [], rows: meals }} />);
    expect(screen.getByText("Greek yogurt bowl")).toBeInTheDocument();
    expect(screen.getByText("280")).toBeInTheDocument();
    expect(screen.getByText("kcal")).toBeInTheDocument();
    expect(screen.getByText("P")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.getByText("F")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("breakfast")).toBeInTheDocument();
    expect(screen.getByText("Jun 11, 08:15")).toBeInTheDocument();
  });

  it("skips a stat whose row value is null", () => {
    const rows = [{ ...meals[0], carbs_g: null }];
    render(<TimelineFeed config={richConfig} data={{ dataset: "meals", columns: [], rows }} />);
    expect(screen.getByText("P")).toBeInTheDocument();
    expect(screen.queryByText("C")).toBeNull();
  });

  it("honors an explicit stat label color", () => {
    const config = {
      ...richConfig,
      stats: [{ field: "protein_g", label: "P", color: "rgb(1, 2, 3)" }],
    };
    render(<TimelineFeed config={config} data={{ dataset: "meals", columns: [], rows: meals }} />);
    expect(screen.getByText("P")).toHaveStyle({ color: "rgb(1, 2, 3)" });
  });

  it("keeps the compact single-line layout when no rich fields are set", () => {
    render(
      <TimelineFeed
        config={{ type: "timeline.feed", dataset: "meals", ts: "ts", titleField: "name", detail: "meal_type" }}
        data={{ dataset: "meals", columns: [], rows: meals }}
      />,
    );
    expect(screen.getByText("Greek yogurt bowl")).toBeInTheDocument();
    expect(screen.getByText("breakfast")).toBeInTheDocument();
    expect(screen.queryByText("280")).toBeNull();
  });
});

describe("timeline.feed expand", () => {
  const manyRows = Array.from({ length: 20 }, (_, i) => ({
    ...meals[0],
    meal_id: i,
    name: `Meal ${i}`,
  }));
  const compact = { type: "timeline.feed", dataset: "meals", ts: "ts", titleField: "name" };

  it("caps rows and offers the see-all affordance by default", () => {
    render(<TimelineFeed config={compact} data={{ dataset: "meals", columns: [], rows: manyRows }} />);
    expect(screen.getByText("See all 20")).toBeInTheDocument();
    expect(screen.queryByText("Meal 0")).toBeNull();
  });

  it("renders every row inline with no see-all when expand is false", () => {
    render(
      <TimelineFeed
        config={{ ...compact, expand: false }}
        data={{ dataset: "meals", columns: [], rows: manyRows }}
      />,
    );
    expect(screen.queryByText("See all 20")).toBeNull();
    expect(screen.getByText("Meal 0")).toBeInTheDocument();
    expect(screen.getByText("Meal 19")).toBeInTheDocument();
  });
});

describe("timeline.feed drilldown", () => {
  it("opens the dialog and renders the embedded island filtered to the clicked row", async () => {
    const ingredients = [
      { item: "Yogurt", grams: 200 },
      { item: "Granola", grams: 40 },
    ];
    const columns = [
      { name: "item", type: "string" },
      { name: "grams", type: "number" },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dataset: "ingredients", columns, rows: ingredients }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const config = {
      ...richConfig,
      drilldown: {
        island: { type: "table.grid", dataset: "ingredients", title: "Ingredients" },
        match: { meal_id: "meal_id" },
      },
    };
    render(withClient(<TimelineFeed config={config} data={{ dataset: "meals", columns: [], rows: meals }} />));

    fireEvent.click(screen.getByText("Greek yogurt bowl"));
    expect(screen.getByText("Ingredients")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Yogurt")).toBeInTheDocument());
    expect(screen.getByText("Granola")).toBeInTheDocument();

    const url = new URL(fetchMock.mock.calls[0]![0] as string, "http://localhost");
    expect(url.searchParams.get("dataset")).toBe("ingredients");
    expect(url.searchParams.get("match.meal_id")).toBe("1");
  });
});
