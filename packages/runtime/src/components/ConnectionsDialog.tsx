import { Badge, Button, Dialog, LinkButton, Loader, Text } from "@cloudflare/kumo";
import { ArrowClockwise, Plug, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { ReactElement } from "react";
import { type ConnectorStatus, syncConnector, useConnectorStatuses } from "../client/useConnectors.js";
import { useAppId } from "../client/useAppId.js";

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diff = then - now;
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms) return fmt.format(Math.round(diff / ms), unit);
  }
  return fmt.format(Math.round(diff / 1000), "second");
}

interface StatusBadge {
  variant: "success" | "error" | "neutral";
  label: string;
}

export function statusBadge(status: ConnectorStatus): StatusBadge {
  if (status.loadError) return { variant: "error", label: "Load error" };
  if (status.lastError) return { variant: "error", label: "Error" };
  if (status.connected) return { variant: "success", label: "Connected" };
  return { variant: "neutral", label: "Not connected" };
}

function ConnectorRow({ status, onSynced }: { status: ConnectorStatus; onSynced: () => void }) {
  const appId = useAppId();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const badge = statusBadge(status);
  const canConnect = status.auth === "oauth2" && !status.connected && status.missingSecrets.length === 0;

  const runSync = async () => {
    setSyncing(true);
    setSyncError(undefined);
    try {
      await syncConnector(appId, status.name);
      onSynced();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 border-b border-kumo-hairline py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Text size="sm" DANGEROUS_className="truncate font-medium text-kumo-strong">
            {status.name}
          </Text>
          <Badge variant={badge.variant} appearance="dot">
            {badge.label}
          </Badge>
        </div>
        <div className="flex flex-none items-center gap-2">
          {canConnect ? (
            <LinkButton
              variant="secondary"
              size="sm"
              href={`/api/connectors/${encodeURIComponent(status.name)}/auth/start?app=${encodeURIComponent(appId)}`}
            >
              Connect
            </LinkButton>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => void runSync()} disabled={syncing}>
            {syncing ? <Loader size="sm" /> : <ArrowClockwise size={14} />}
            Sync now
          </Button>
        </div>
      </div>
      {status.description ? (
        <Text size="sm" variant="secondary">
          {status.description}
        </Text>
      ) : null}
      <div className="flex flex-col gap-0.5">
        {status.lastSync ? (
          <Text size="sm" variant="secondary">
            Last synced {relativeTime(status.lastSync)}
          </Text>
        ) : null}
        {status.loadError ? (
          <Text size="sm" DANGEROUS_className="text-kumo-danger">
            {status.loadError}
          </Text>
        ) : null}
        {status.lastError ? (
          <Text size="sm" DANGEROUS_className="text-kumo-danger">
            {status.lastError}
          </Text>
        ) : null}
        {status.missingSecrets.length > 0 ? (
          <Text size="sm" DANGEROUS_className="text-kumo-warning">
            Missing secrets: {status.missingSecrets.join(", ")}
          </Text>
        ) : null}
        {syncError ? (
          <Text size="sm" DANGEROUS_className="text-kumo-danger">
            {syncError}
          </Text>
        ) : null}
      </div>
    </div>
  );
}

export function ConnectionsDialog({ trigger }: { trigger: ReactElement }) {
  const { statuses, loading, error, refresh } = useConnectorStatuses();

  return (
    <Dialog.Root>
      <Dialog.Trigger render={trigger} />
      <Dialog size="base" className="t-modal flex max-h-[85vh] w-[min(92vw,32rem)] flex-col p-6">
        <div className="mb-2 flex items-start justify-between gap-4">
          <Dialog.Title className="text-base font-medium">Connections</Dialog.Title>
          <Dialog.Close
            aria-label="Close"
            render={(props) => (
              <Button {...props} variant="ghost" size="sm" shape="square" aria-label="Close">
                <X size={14} />
              </Button>
            )}
          />
        </div>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader />
            </div>
          ) : error ? (
            <Text size="sm" DANGEROUS_className="text-kumo-danger">
              {error}
            </Text>
          ) : statuses.length === 0 ? (
            <Text size="sm" variant="secondary">
              No connectors configured.
            </Text>
          ) : (
            statuses.map((status) => (
              <ConnectorRow key={status.name} status={status} onSynced={() => void refresh()} />
            ))
          )}
        </div>
      </Dialog>
    </Dialog.Root>
  );
}

export function ConnectionsButton() {
  return (
    <ConnectionsDialog
      trigger={
        <Button variant="ghost" size="sm" aria-label="Connections">
          <Plug size={16} />
        </Button>
      }
    />
  );
}
