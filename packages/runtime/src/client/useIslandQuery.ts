import { useQuery } from "@tanstack/react-query";
import type { IslandConfig, QueryPayload } from "../types.js";
import { useAppId } from "./useAppId.js";

/** The active page filter applied to an island's dataset, if any. */
export interface ActiveRange {
  field: string;
  from?: string;
  to?: string;
}

/** The active select narrowing applied to an island's dataset, if any. */
export interface ActiveSelect {
  field: string;
  values: string[];
}

/** Stable hash of an island config so two islands on the same dataset cache separately. */
export function islandConfigHash(config: IslandConfig): string {
  const { id: _id, title: _title, span: _span, ...rest } = config;
  return JSON.stringify(rest, Object.keys(rest).toSorted());
}

/** App id leads the key so caches never bleed across apps with same-named datasets. */
export function islandQueryKey(
  appId: string,
  config: IslandConfig,
  range?: ActiveRange,
  select?: ActiveSelect,
): [string, string, string, string, string, string] {
  const rangeKey = range ? `${range.field}:${range.from ?? ""}:${range.to ?? ""}` : "";
  const selectKey = select && select.values.length ? `${select.field}:${[...select.values].toSorted().join(",")}` : "";
  return ["island-data", appId, config.dataset ?? "", islandConfigHash(config), rangeKey, selectKey];
}

function queryUrl(appId: string, dataset: string, range?: ActiveRange, select?: ActiveSelect): string {
  const params = new URLSearchParams({ app: appId, dataset });
  if (range) {
    params.set("filterField", range.field);
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
  }
  if (select && select.values.length) {
    params.set(`select.${select.field}`, select.values.join(","));
  }
  return `/api/query?${params.toString()}`;
}

async function fetchJson(appId: string, dataset: string, range?: ActiveRange, select?: ActiveSelect): Promise<QueryPayload> {
  const res = await fetch(queryUrl(appId, dataset, range, select), {
    headers: { accept: "application/json" },
  });
  const body = (await res.json()) as QueryPayload | { error: string; dataset?: string };
  if (!res.ok || "error" in body) {
    throw new Error("error" in body ? body.error : `query failed (${res.status})`);
  }
  return body;
}

export function useIslandQuery(config: IslandConfig, enabled: boolean, range?: ActiveRange, select?: ActiveSelect) {
  const appId = useAppId();
  return useQuery({
    queryKey: islandQueryKey(appId, config, range, select),
    queryFn: () => fetchJson(appId, config.dataset!, range, select),
    enabled: enabled && Boolean(config.dataset),
    staleTime: 30_000,
  });
}

/** A `match.<column>=<value>` equality narrowing of a drilldown island's dataset. */
export interface MatchPair {
  field: string;
  value: string;
}

function drilldownUrl(appId: string, dataset: string, match: MatchPair[]): string {
  const params = new URLSearchParams({ app: appId, dataset });
  for (const { field, value } of match) params.set(`match.${field}`, value);
  return `/api/query?${params.toString()}`;
}

async function fetchDrilldown(
  appId: string,
  dataset: string,
  match: MatchPair[],
): Promise<QueryPayload> {
  const res = await fetch(drilldownUrl(appId, dataset, match), {
    headers: { accept: "application/json" },
  });
  const body = (await res.json()) as QueryPayload | { error: string; dataset?: string };
  if (!res.ok || "error" in body) {
    throw new Error("error" in body ? body.error : `query failed (${res.status})`);
  }
  return body;
}

/** Fetches a drilldown island's rows filtered to a clicked row, only while its dialog is open. */
export function useDrilldownQuery(dataset: string, match: MatchPair[], enabled: boolean) {
  const appId = useAppId();
  return useQuery({
    queryKey: ["drilldown", appId, dataset, ...match.flatMap((m) => [m.field, m.value])],
    queryFn: () => fetchDrilldown(appId, dataset, match),
    enabled: enabled && Boolean(dataset),
    staleTime: 30_000,
  });
}
