import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { IslandTile } from "../src/components/IslandTile.js";
import {
  applyValidation,
  handleRuntimeEvent,
  islandErrorKey,
} from "../src/client/useLiveUpdates.js";

function withQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("applyValidation", () => {
  it("keys island errors by page#index", () => {
    const map = applyValidation([
      { page: "overview", index: 1, type: "metric.kpi", field: "value", message: "missing" },
    ]);
    expect(map.get(islandErrorKey("overview", 1))?.field).toBe("value");
  });
});

describe("handleRuntimeEvent", () => {
  it("invalidates bound queries and clears errors on datasets-changed", () => {
    const client = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    const setErrors = vi.fn();
    handleRuntimeEvent({ type: "datasets-changed", datasets: ["nw"] }, client, setErrors, "finance");
    expect(client.invalidateQueries).toHaveBeenCalledOnce();
    expect(setErrors).toHaveBeenCalledWith(new Map());
  });

  it("sets the island-error map on a validation event without invalidating", () => {
    const client = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    const setErrors = vi.fn();
    handleRuntimeEvent(
      {
        type: "validation",
        islandErrors: [{ page: "p", index: 0, type: "metric.kpi", field: "v", message: "missing" }],
      },
      client,
      setErrors,
      "finance",
    );
    expect(client.invalidateQueries).not.toHaveBeenCalled();
    const map = setErrors.mock.calls[0]![0] as Map<string, unknown>;
    expect(map.has(islandErrorKey("p", 0))).toBe(true);
  });
});

describe("IslandTile live error", () => {
  it("renders the fail-loudly card when a live validation error targets it", () => {
    render(
      withQuery(
        <IslandTile
          config={{ type: "metric.kpi", title: "Net worth", dataset: "nw", value: "net_worth_eur" }}
          liveError={{
            page: "overview",
            index: 0,
            type: "metric.kpi",
            field: "net_worth_eur",
            message: "missing field 'net_worth_eur' in dataset 'nw'",
          }}
        />,
      ),
    );
    expect(screen.getByTestId("island-error")).toBeInTheDocument();
    expect(screen.getByText("net_worth_eur")).toBeInTheDocument();
  });
});
