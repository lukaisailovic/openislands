import { Button, Dialog, Text, cn } from "@cloudflare/kumo";
import { ArrowCounterClockwise, ClockCounterClockwise, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useAppId } from "../../client/useAppId.js";
import { history, restore } from "./api.js";
import type { FileVersion } from "./types.js";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeTime(timestamp: number): string {
  const delta = timestamp - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return RELATIVE.format(Math.round(delta / ms), unit);
  }
  return "just now";
}

function byteLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function HistoryPanel({
  open,
  onOpenChange,
  path,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  path: string;
  onRestored: () => void;
}) {
  const appId = useAppId();
  const [state, setState] = useState<{ versions?: FileVersion[]; error?: string }>({});
  const [restoringId, setRestoringId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({});
    history(appId, path)
      .then((versions) => !cancelled && setState({ versions }))
      .catch((error: Error) => !cancelled && setState({ error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [open, appId, path]);

  const handleRestore = async (id: number) => {
    setRestoringId(id);
    try {
      await restore(appId, path, id);
      onOpenChange(false);
      onRestored();
    } finally {
      setRestoringId(null);
    }
  };

  const versions = state.versions ?? [];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size="base" className="t-modal flex max-h-[80vh] w-[min(92vw,28rem)] flex-col p-0">
        <div className="flex items-center gap-3 border-b border-kumo-hairline p-5">
          <div className="flex size-9 flex-none items-center justify-center rounded-lg bg-kumo-recessed text-kumo-subtle">
            <ClockCounterClockwise size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <Dialog.Title className="text-base font-medium text-kumo-strong">Version history</Dialog.Title>
            <Dialog.Description className="mt-0.5 truncate text-sm text-kumo-subtle">
              {path}
            </Dialog.Description>
          </div>
          <Dialog.Close
            aria-label="Close"
            render={(props) => (
              <Button {...props} variant="ghost" size="sm" shape="square" aria-label="Close">
                <X size={14} />
              </Button>
            )}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {state.error ? (
            <Text variant="secondary" size="sm" DANGEROUS_className="block p-4 text-kumo-danger">
              {state.error}
            </Text>
          ) : state.versions === undefined ? (
            <Text variant="secondary" size="sm" DANGEROUS_className="block p-4">
              Loading…
            </Text>
          ) : versions.length === 0 ? (
            <Text variant="secondary" size="sm" DANGEROUS_className="block p-4">
              No saved versions yet. Earlier states are snapshotted as you save.
            </Text>
          ) : (
            <ul className="flex flex-col gap-1">
              {versions.map((version) => (
                <li
                  key={version.id}
                  className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-kumo-tint"
                >
                  <div className="min-w-0 flex-1">
                    <Text size="sm" DANGEROUS_className="block truncate text-kumo-strong">
                      {version.label ?? relativeTime(version.createdAt)}
                    </Text>
                    <Text variant="secondary" size="xs" DANGEROUS_className="block">
                      {version.label ? `${relativeTime(version.createdAt)} · ` : ""}
                      {byteLabel(version.byteSize)}
                    </Text>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={ArrowCounterClockwise}
                    loading={restoringId === version.id}
                    disabled={restoringId !== null}
                    onClick={() => handleRestore(version.id)}
                    className={cn(restoringId !== null && restoringId !== version.id && "opacity-50")}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
