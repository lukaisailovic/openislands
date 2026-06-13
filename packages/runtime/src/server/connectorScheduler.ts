import {
  type ConnectorStatus,
  listConnectorStatuses,
  parseSchedule,
  runConnectorSync,
} from "@openislands/compiler";
import type { RuntimeEventBroadcaster } from "./watcher.js";

const started = new Set<string>();
const timers: ReturnType<typeof setInterval>[] = [];

function isOverdue(status: ConnectorStatus, intervalMs: number): boolean {
  if (!status.lastSync) return true;
  const last = Date.parse(status.lastSync);
  if (Number.isNaN(last)) return true;
  return last + intervalMs <= Date.now();
}

async function runAndBroadcast(
  projectDir: string,
  name: string,
  broadcaster: RuntimeEventBroadcaster,
): Promise<void> {
  try {
    await runConnectorSync(projectDir, name);
  } catch {
    // The connector status (lastError) is persisted by runConnectorSync; the
    // UI surfaces it on the next status fetch.
  }
  broadcaster.publish({ type: "connectors-changed" });
}

/**
 * Starts a background scheduler for every connector that declares an effective
 * schedule. Each one syncs immediately on boot when it has never synced or is
 * overdue, then on a fixed interval. Idempotent per app — a no-op after the
 * first call for a project dir and when it declares no scheduled connectors.
 */
export async function startConnectorScheduler(
  projectDir: string,
  broadcaster: RuntimeEventBroadcaster,
): Promise<void> {
  if (started.has(projectDir)) return;
  started.add(projectDir);

  let statuses: ConnectorStatus[];
  try {
    statuses = await listConnectorStatuses(projectDir);
  } catch (e) {
    // A broken manifest must never crash the dev server. The app already
    // surfaces its validation errors in the UI; skip scheduling until it's fixed.
    console.error(`[openislands] connector scheduler skipped for ${projectDir}: ${(e as Error).message}`);
    return;
  }
  for (const status of statuses) {
    if (!status.schedule) continue;
    let intervalMs: number;
    try {
      intervalMs = parseSchedule(status.schedule);
    } catch {
      continue;
    }
    if (isOverdue(status, intervalMs)) void runAndBroadcast(projectDir, status.name, broadcaster);
    timers.push(
      setInterval(() => void runAndBroadcast(projectDir, status.name, broadcaster), intervalMs),
    );
  }
}

export function stopConnectorScheduler(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
  started.clear();
}
