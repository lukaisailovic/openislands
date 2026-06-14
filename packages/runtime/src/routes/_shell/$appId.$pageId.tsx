import { createFileRoute, notFound, useLoaderData } from "@tanstack/react-router";
import { Text } from "@cloudflare/kumo";
import type { Page } from "@openislands/schema";
import { Dashboard } from "../../components/Dashboard.js";
import { getDashboard, getFilterOptions } from "../../server/dashboard.js";

export interface PageSearch {
  group?: string;
  from?: string;
  to?: string;
  [filterId: string]: string | undefined;
}

const RESERVED_SEARCH_KEYS = new Set(["group", "from", "to"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && ISO_DATE.test(value) ? value : undefined;
}

export const Route = createFileRoute("/_shell/$appId/$pageId")({
  validateSearch: (search: Record<string, unknown>): PageSearch => {
    const out: PageSearch = {};
    if (typeof search.group === "string") out.group = search.group;
    const from = isoOrUndefined(search.from);
    const to = isoOrUndefined(search.to);
    if (from) out.from = from;
    if (to) out.to = to;
    for (const [key, value] of Object.entries(search)) {
      if (RESERVED_SEARCH_KEYS.has(key)) continue;
      if (typeof value === "string" && value.length > 0) out[key] = value;
    }
    return out;
  },
  loader: async ({ params }) => {
    const { manifest } = await getDashboard({ data: { appId: params.appId } });
    if (!manifest.pages.some((p) => p.id === params.pageId)) {
      throw notFound({ data: { pages: manifest.pages.map((p) => p.id) } });
    }
    const filterOptions = await getFilterOptions({ data: { appId: params.appId, pageId: params.pageId } });
    return { pageId: params.pageId, filterOptions };
  },
  component: PageView,
  notFoundComponent: PageNotFound,
});

function activeGroupFor(page: Page, requested: string | undefined): string | undefined {
  if (!page.groups || page.groups.length === 0) return undefined;
  const match = page.groups.find((g) => g.id === requested);
  return (match ?? page.groups[0]!).id;
}

function PageView() {
  const { pageId } = Route.useParams();
  const search = Route.useSearch();
  const { filterOptions } = Route.useLoaderData();
  const { manifest, customIslands } = useLoaderData({ from: "/_shell/$appId" });

  const page = manifest.pages.find((p) => p.id === pageId)!;
  const selected: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(search)) {
    if (RESERVED_SEARCH_KEYS.has(key) || typeof value !== "string") continue;
    selected[key] = value.split(",").filter(Boolean);
  }

  return (
    <Dashboard
      manifest={manifest}
      page={page}
      activeGroup={activeGroupFor(page, search.group)}
      range={{ from: search.from, to: search.to }}
      selected={selected}
      filterOptions={filterOptions}
      customIslands={customIslands}
    />
  );
}

function PageNotFound() {
  const { manifest } = useLoaderData({ from: "/_shell/$appId" });
  return (
    <div className="py-10">
      <Text variant="heading3" as="h1">
        Page not found
      </Text>
      <Text variant="secondary" size="sm" DANGEROUS_className="mt-2">
        Available pages: {manifest.pages.map((p) => p.id).join(", ") || "none"}
      </Text>
    </div>
  );
}
