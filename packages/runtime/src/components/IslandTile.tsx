import { type CSSProperties, useMemo } from "react";
import { SkeletonLine } from "@cloudflare/kumo";
import type { DatasetSpec } from "@openislands/schema";
import { BUILTIN_ISLAND_TYPES, type IslandType } from "@openislands/schema";
import { type ActiveRange, type ActiveSelect, useIslandQuery } from "../client/useIslandQuery.js";
import { useAppId } from "../client/useAppId.js";
import { makeCustomIsland } from "../islands/CustomIsland.js";
import { islandNeedsData, type IslandRenderer, resolveRenderer } from "../islands/registry.js";
import type {
  CustomIslandMap,
  IslandConfig,
  IslandQueryError,
  IslandValidationError,
  QueryPayload,
} from "../types.js";
import { IslandErrorCard } from "./IslandErrorCard.js";
import { IslandCard, type SourceInfo } from "./primitives.js";

const DEFAULT_SPAN = 6;

/**
 * Built-ins resolve from the static registry. An unknown type with a custom
 * component on disk gets a lazy client-loaded renderer; without one it falls
 * through to the placeholder (resolveRenderer's default).
 */
function useRenderer(type: string, customIslands: CustomIslandMap | undefined): IslandRenderer {
  const appId = useAppId();
  const version = customIslands?.[type]?.version;
  return useMemo(() => {
    if (BUILTIN_ISLAND_TYPES.includes(type as IslandType)) return resolveRenderer(type);
    if (version !== undefined) return makeCustomIsland(appId, type, version);
    return resolveRenderer(type);
  }, [appId, type, version]);
}

export function sourceInfo(
  config: IslandConfig,
  spec: DatasetSpec | undefined,
  data: QueryPayload | undefined,
): SourceInfo | null {
  const file = config.file as string | undefined;
  if (file) return { name: file, path: file, kind: "file" };
  if (!config.dataset) return null;
  const columns = data?.columns;
  const rows = data?.rows;
  return {
    name: config.dataset,
    path: spec?.source ?? spec?.sql,
    table: spec?.table,
    kind: spec?.sql ? "sql" : "file",
    description: spec?.description,
    columns: columns && columns.length > 0 ? columns : undefined,
    rows: rows && rows.length > 0 ? rows : undefined,
  };
}

function toIslandError(message: string, config: IslandConfig): IslandQueryError {
  return { dataset: config.dataset, message };
}

export function IslandTile({
  config,
  datasetSpec,
  range,
  select,
  liveError,
  customIslands,
}: {
  config: IslandConfig;
  datasetSpec?: DatasetSpec;
  range?: ActiveRange;
  select?: ActiveSelect;
  liveError?: IslandValidationError;
  customIslands?: CustomIslandMap;
}) {
  const needsData = islandNeedsData(config.type);
  const queryResult = useIslandQuery(config, needsData, range, select);
  const Renderer = useRenderer(config.type, customIslands);

  const span = typeof config.span === "number" ? config.span : DEFAULT_SPAN;
  const tileStyle = { "--oi-span": span } as CSSProperties;

  if (liveError) {
    return (
      <div className="oi-tile" style={tileStyle}>
        <IslandErrorCard
          config={config}
          error={{ dataset: config.dataset, field: liveError.field, message: liveError.message }}
        />
      </div>
    );
  }

  if (needsData && queryResult.isError) {
    const message =
      queryResult.error instanceof Error ? queryResult.error.message : String(queryResult.error);
    return (
      <div className="oi-tile" style={tileStyle}>
        <IslandErrorCard config={config} error={toIslandError(message, config)} />
      </div>
    );
  }

  if (config.type === "content.editor") {
    return (
      <div className="oi-tile" style={tileStyle}>
        <Renderer config={config} data={undefined} />
      </div>
    );
  }

  return (
    <IslandCard
      className="oi-tile"
      style={tileStyle}
      title={config.title as string | undefined}
      source={sourceInfo(config, datasetSpec, queryResult.data)}
    >
      {needsData && queryResult.isLoading ? (
        <div>
          <div className="mb-4 h-4">
            <SkeletonLine minWidth={40} maxWidth={60} />
          </div>
          <div className="flex flex-col gap-2">
            <SkeletonLine />
            <SkeletonLine />
            <SkeletonLine minWidth={50} maxWidth={70} />
          </div>
        </div>
      ) : (
        <Renderer config={config} data={queryResult.data} />
      )}
    </IslandCard>
  );
}
