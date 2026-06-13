import { useEffect, useState } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type { IslandValidationError, RuntimeEvent } from "../types.js";
import { useAppId } from "./useAppId.js";

/** Stable key for an island error so live validation can target a single tile. */
export function islandErrorKey(page: string, index: number): string {
  return `${page}#${index}`;
}

/** A query key belongs to a changed dataset when its app and dataset segments match. */
export function queryKeyMatchesDatasets(
  queryKey: readonly unknown[],
  datasets: Set<string>,
  appId: string,
): boolean {
  return (
    queryKey[0] === "island-data" &&
    queryKey[1] === appId &&
    typeof queryKey[2] === "string" &&
    datasets.has(queryKey[2])
  );
}

/** Invalidate only the app's island queries bound to the changed datasets. */
export function invalidateDatasets(client: QueryClient, datasets: string[], appId: string): void {
  if (datasets.length === 0) return;
  const set = new Set(datasets);
  void client.invalidateQueries({
    predicate: (q) => queryKeyMatchesDatasets(q.queryKey, set, appId),
  });
}

/** Fold a runtime validation event into the keyed error map for fail-loudly tiles. */
export function applyValidation(
  errors: IslandValidationError[],
): Map<string, IslandValidationError> {
  const map = new Map<string, IslandValidationError>();
  for (const e of errors) map.set(islandErrorKey(e.page, e.index), e);
  return map;
}

export function handleRuntimeEvent(
  event: RuntimeEvent,
  client: QueryClient,
  setErrors: (errors: Map<string, IslandValidationError>) => void,
  appId: string,
): void {
  if (event.type === "datasets-changed") {
    invalidateDatasets(client, event.datasets, appId);
    setErrors(new Map());
    return;
  }
  if (event.type === "validation") {
    setErrors(applyValidation(event.islandErrors));
    return;
  }
  setErrors(new Map());
}

/**
 * Subscribes to /api/events for the lifetime of the dashboard. A datasets-changed
 * event invalidates only the bound queries (those islands refetch, nothing else);
 * a validation event flips the named islands into the fail-loudly state. Returns
 * the current live island-error map keyed by `page#index`.
 */
export function useLiveUpdates(): Map<string, IslandValidationError> {
  const client = useQueryClient();
  const router = useRouter();
  const appId = useAppId();
  const [errors, setErrors] = useState<Map<string, IslandValidationError>>(() => new Map());

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/events?app=${encodeURIComponent(appId)}`);
    const onMessage = (raw: MessageEvent<string>) => {
      const event = JSON.parse(raw.data) as RuntimeEvent;
      handleRuntimeEvent(event, client, setErrors, appId);
      void router.invalidate();
    };
    source.addEventListener("datasets-changed", onMessage as EventListener);
    source.addEventListener("validation", onMessage as EventListener);
    source.addEventListener("components-changed", onMessage as EventListener);
    return () => source.close();
  }, [client, router, appId]);

  return errors;
}
