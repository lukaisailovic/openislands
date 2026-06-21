/**
 * Rollback checkpoints under the AppStateStore `history/` prefix. Two kinds share
 * one id space: `ckpt-<ts>` snapshots the manifest (stored as `<id>.json`);
 * `ckpt-<ts>!<encoded-path>` snapshots a data file written by an action (stored
 * under the id verbatim — the id encodes the restore target). The compiler writes
 * data checkpoints to the same keys, so the byte format stays compatible.
 */
import type { AppStateStore, ContentStore } from "@openislands/storage";
import { confineDatasetSource } from "./paths.js";

const MANIFEST_CHECKPOINT_FILE = /^ckpt-\d+\.json$/;
const MANIFEST_CHECKPOINT = /^ckpt-\d+$/;
const DATA_CHECKPOINT = /^ckpt-\d+!.+$/;

export const isCheckpointId = (id: string): boolean => MANIFEST_CHECKPOINT.test(id) || DATA_CHECKPOINT.test(id);

export interface CheckpointStore {
  /** Checkpoint ids, oldest first. */
  list(): Promise<string[]>;
  /** Snapshot the current manifest content; returns the checkpoint id. */
  snapshotManifest(manifest: string): Promise<string>;
  /** Restore a checkpoint byte-for-byte; returns whether a data file was touched. */
  restore(id: string): Promise<{ restoredData: boolean }>;
  /** Keep the newest `keep` checkpoints, delete the rest. Returns the counts. */
  prune(keep: number): Promise<{ kept: number; removed: number }>;
}

/** The AppStateStore key for a checkpoint id — manifest snapshots carry a `.json`
 * suffix, data snapshots are stored under the id verbatim. The single source of this
 * derivation, shared by every method so the cross-package byte format stays intact. */
const keyFor = (id: string): string => `history/${id}${MANIFEST_CHECKPOINT.test(id) ? ".json" : ""}`;

export function createCheckpointStore(projectRoot: string, appState: AppStateStore, content: ContentStore): CheckpointStore {
  async function list(): Promise<string[]> {
    const entries = await appState.list("history");
    return entries
      .map((entry) => (MANIFEST_CHECKPOINT_FILE.test(entry.name) ? entry.name.slice(0, -".json".length) : entry.name))
      .filter(isCheckpointId)
      .toSorted();
  }

  return {
    list,
    async snapshotManifest(manifest) {
      const id = `ckpt-${Date.now()}`;
      await appState.put(keyFor(id), manifest);
      return id;
    },
    async restore(id) {
      if (DATA_CHECKPOINT.test(id)) {
        const encodedTarget = id.slice(id.indexOf("!") + 1);
        const targetAbs = confineDatasetSource(projectRoot, decodeURIComponent(encodedTarget));
        const bytes = await appState.get(keyFor(id));
        if (bytes === null) throw new Error(`checkpoint '${id}' has no stored data`);
        await content.writeBytes(targetAbs, bytes);
        return { restoredData: true };
      }
      const text = await appState.getText(keyFor(id));
      if (text === null) throw new Error(`checkpoint '${id}' has no stored manifest`);
      await content.writeText("app/manifest.json", text);
      return { restoredData: false };
    },
    async prune(keep) {
      const ids = await list();
      const doomed = ids.slice(0, Math.max(0, ids.length - keep));
      for (const id of doomed) await appState.delete(keyFor(id));
      return { kept: ids.length - doomed.length, removed: doomed.length };
    },
  };
}
