import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IslandErrorCard } from "../src/components/IslandErrorCard.js";
import { IslandTile } from "../src/components/IslandTile.js";

function withQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("fail-loudly error card", () => {
  it("names the island, dataset, missing field, and tells the user to ask their agent", () => {
    render(
      <IslandErrorCard
        config={{ type: "metric.kpi", title: "Net worth", dataset: "net_worth" }}
        error={{
          dataset: "net_worth",
          field: "net_worth_eur",
          message: "field 'net_worth_eur' not found",
        }}
      />,
    );
    expect(screen.getByText(/Net worth — can't render/)).toBeInTheDocument();
    expect(screen.getByText("metric.kpi")).toBeInTheDocument();
    expect(screen.getByText("net_worth")).toBeInTheDocument();
    expect(screen.getByText("net_worth_eur")).toBeInTheDocument();
    expect(screen.getByText(/ask your agent/i)).toBeInTheDocument();
  });

  it("an island whose query fails renders only its own error card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "unknown dataset 'missing'", dataset: "missing" }), {
            status: 422,
          }),
      ),
    );

    render(
      withQuery(<IslandTile config={{ type: "table.grid", title: "Rows", dataset: "missing" }} />),
    );

    await waitFor(() => expect(screen.getByTestId("island-error")).toBeInTheDocument());
    expect(screen.getByText(/unknown dataset/)).toBeInTheDocument();
  });

  it("a data-free island renders without firing a query", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(withQuery(<IslandTile config={{ type: "note.card", markdown: "hello" }} />));
    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
