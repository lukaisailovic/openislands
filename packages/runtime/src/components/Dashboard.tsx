import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Text } from "@cloudflare/kumo";
import { type BuiltinIsland, type Manifest, type Page, flattenPageIslands } from "@openislands/schema";
import { type RangeBounds, activeRanges } from "../client/pageFilters.js";
import { useAppId } from "../client/useAppId.js";
import { islandErrorKey, useLiveUpdates } from "../client/useLiveUpdates.js";
import type { CustomIslandMap, IslandConfig } from "../types.js";
import { IslandTile } from "./IslandTile.js";
import { PageFilters } from "./PageFilters.js";
import { PageHeader } from "./PageHeader.js";

interface Props {
  manifest: Manifest;
  page: Page;
  activeGroup?: string;
  range?: RangeBounds;
  customIslands?: CustomIslandMap;
}

export function Dashboard({ manifest, page, activeGroup, range, customIslands }: Props) {
  const navigate = useNavigate();
  const appId = useAppId();
  const liveErrors = useLiveUpdates();
  const multiPage = manifest.pages.length > 1;
  const flat = flattenPageIslands(page).filter(({ groupId }) => groupId === activeGroup);
  const bounds = range ?? {};
  const ranges = activeRanges(page, bounds);

  const setBounds = (next: RangeBounds) => {
    navigate({
      to: "/$appId/$pageId",
      params: { appId, pageId: page.id },
      search: (prev) => ({ ...prev, from: next.from, to: next.to }),
    });
  };

  const filters = page.filters ? (
    <PageFilters filters={page.filters} bounds={bounds} onChange={setBounds} />
  ) : null;

  const renderTile = ({ island, index }: { island: BuiltinIsland; index: number }) => {
    const config = island as IslandConfig;
    const key = typeof config.id === "string" ? config.id : `${page.id}-${index}`;
    return (
      <IslandTile
        key={key}
        config={config}
        datasetSpec={config.dataset ? manifest.datasets[config.dataset] : undefined}
        range={config.dataset ? ranges.get(config.dataset) : undefined}
        liveError={liveErrors.get(islandErrorKey(page.id, index))}
        customIslands={customIslands}
      />
    );
  };

  const tiles: ReactNode[] = [];
  for (let i = 0; i < flat.length; ) {
    const { rowKey } = flat[i]!;
    if (!rowKey) {
      tiles.push(renderTile(flat[i]!));
      i++;
      continue;
    }
    const rowEntries = [];
    while (i < flat.length && flat[i]!.rowKey === rowKey) {
      rowEntries.push(flat[i]!);
      i++;
    }
    tiles.push(
      <div key={rowKey} className="oi-row grid grid-cols-12 gap-4">
        {rowEntries.map(renderTile)}
      </div>,
    );
  }

  return (
    <div>
      {multiPage ? (
        <PageHeader appTitle={manifest.title} page={page} activeGroup={activeGroup} filters={filters} />
      ) : (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <Text variant="heading2" as="h1" className="tracking-tight">
              {manifest.title}
            </Text>
            <Text variant="secondary" size="sm" className="mt-1">
              Built by OpenIslands · your data, your files, your dashboard
            </Text>
          </div>
          {filters}
        </div>
      )}

      <div className="oi-grid grid grid-cols-12 gap-4">{tiles}</div>
    </div>
  );
}
