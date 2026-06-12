import { useCallback, useEffect, useState } from "react";
import type { ConnectorStatus, SyncResult } from "@openislands/compiler";
import { useAppId } from "./useAppId.js";

export type { ConnectorStatus, SyncResult };

async function fetchStatuses(appId: string): Promise<ConnectorStatus[]> {
  const res = await fetch(`/api/connectors?app=${encodeURIComponent(appId)}`);
  if (!res.ok) throw new Error(`failed to load connectors (${res.status})`);
  return (await res.json()) as ConnectorStatus[];
}

/**
 * Loads connector statuses and keeps them fresh: a refetch on mount, on demand
 * after a sync, and whenever the SSE stream reports a `connectors-changed`
 * event (a scheduled or remote sync wrote new state).
 */
export function useConnectorStatuses(): {
  statuses: ConnectorStatus[];
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
} {
  const appId = useAppId();
  const [statuses, setStatuses] = useState<ConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setStatuses(await fetchStatuses(appId));
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void refresh();
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/events?app=${encodeURIComponent(appId)}`);
    const onChange = () => void refresh();
    source.addEventListener("connectors-changed", onChange);
    return () => source.close();
  }, [refresh, appId]);

  return { statuses, loading, error, refresh };
}

export async function syncConnector(appId: string, name: string): Promise<SyncResult> {
  const res = await fetch(
    `/api/connectors/${encodeURIComponent(name)}/sync?app=${encodeURIComponent(appId)}`,
    { method: "POST" },
  );
  const body = (await res.json()) as SyncResult | { error: string };
  if (!res.ok) throw new Error("error" in body ? body.error : `sync failed (${res.status})`);
  return body as SyncResult;
}
