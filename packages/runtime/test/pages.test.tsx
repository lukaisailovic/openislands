import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { type Manifest, validateManifest } from "@openislands/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppIdContext } from "../src/client/useAppId.js";
import { AppShell } from "../src/components/AppShell.js";
import { Dashboard } from "../src/components/Dashboard.js";

afterEach(() => vi.restoreAllMocks());

const APP_ID = "finance";

function renderAtPage(manifest: Manifest, pageId: string, group?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$appId/$pageId",
    validateSearch: (s: Record<string, unknown>) =>
      typeof s.group === "string" ? { group: s.group } : {},
    component: () => {
      const params = pageRoute.useParams();
      const search = pageRoute.useSearch();
      const page = manifest.pages.find((p) => p.id === params.pageId)!;
      const active = page.groups
        ? (page.groups.find((g) => g.id === search.group) ?? page.groups[0]!).id
        : undefined;
      return (
        <AppIdContext.Provider value={params.appId}>
          <AppShell manifest={manifest} manifestErrors={[]} apps={[]}>
            <Dashboard manifest={manifest} page={page} activeGroup={active} />
          </AppShell>
        </AppIdContext.Provider>
      );
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({
      initialEntries: [group ? `/${APP_ID}/${pageId}?group=${group}` : `/${APP_ID}/${pageId}`],
    }),
  });
  render(
    <QueryClientProvider client={client}>
      {/* @ts-expect-error test router shape differs from the app's registered router */}
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const flatPage = {
  version: 1 as const,
  title: "Solo",
  datasets: {},
  pages: [
    {
      id: "overview",
      title: "Overview",
      layout: "grid" as const,
      islands: [{ type: "note.card" as const, markdown: "only note" }],
    },
  ],
};

const multiPage = {
  version: 1 as const,
  title: "Finance Overview",
  datasets: {},
  pages: [
    {
      id: "overview",
      title: "Overview",
      icon: "house" as const,
      layout: "grid" as const,
      islands: [{ type: "note.card" as const, markdown: "overview note" }],
    },
    {
      id: "holdings",
      title: "Holdings",
      icon: "wallet" as const,
      layout: "grid" as const,
      groups: [
        {
          id: "positions",
          title: "Positions",
          islands: [{ type: "note.card" as const, markdown: "positions note" }],
        },
        {
          id: "activity",
          title: "Activity",
          islands: [{ type: "note.card" as const, markdown: "activity note" }],
        },
      ],
    },
  ],
};

describe("page shell", () => {
  it("renders a sidebar link per page on a multi-page manifest", async () => {
    renderAtPage(multiPage, "overview");
    await waitFor(() => expect(screen.getByText("overview note")).toBeInTheDocument());
    const nav = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(nav).toContain("/finance/overview");
    expect(nav).toContain("/finance/holdings");
  });

  it("renders tabs and only the active group's islands on a grouped page", async () => {
    renderAtPage(multiPage, "holdings", "activity");
    await waitFor(() => expect(screen.getByText("activity note")).toBeInTheDocument());
    expect(screen.queryByText("positions note")).not.toBeInTheDocument();
    expect(screen.getByText("Positions")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
  });

  it("defaults a grouped page to its first group", async () => {
    renderAtPage(multiPage, "holdings");
    await waitFor(() => expect(screen.getByText("positions note")).toBeInTheDocument());
    expect(screen.queryByText("activity note")).not.toBeInTheDocument();
  });

  it("renders no sidebar or tabs on a single-page manifest", async () => {
    renderAtPage(flatPage, "overview");
    await waitFor(() => expect(screen.getByText("only note")).toBeInTheDocument());
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});

describe("layout.row rendering", () => {
  const rowManifest = validateManifest({
    version: 1,
    title: "T",
    datasets: {},
    pages: [
      {
        id: "p",
        layout: "grid",
        islands: [
          { type: "note.card", markdown: "loose" },
          { type: "layout.row", id: "r", islands: [{ type: "note.card", markdown: "in-row" }] },
        ],
      },
    ],
  }).manifest!;

  it("wraps row children in an .oi-row div and renders loose islands directly", async () => {
    renderAtPage(rowManifest, "p");
    await waitFor(() => expect(screen.getByText("in-row")).toBeInTheDocument());
    expect(screen.getByText("loose")).toBeInTheDocument();
    const rows = document.querySelectorAll(".oi-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("in-row");
    expect(rows[0]!.textContent).not.toContain("loose");
  });
});
