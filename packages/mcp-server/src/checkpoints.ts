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
}

export function createCheckpointStore(projectRoot: string, appState: AppStateStore, content: ContentStore): CheckpointStore {
  return {
    async list() {
      const entries = await appState.list("history");
      return entries
        .map((entry) => (MANIFEST_CHECKPOINT_FILE.test(entry.name) ? entry.name.slice(0, -".json".length) : entry.name))
        .filter(isCheckpointId)
        .toSorted();
    },
    async snapshotManifest(manifest) {
      const id = `ckpt-${Date.now()}`;
      await appState.put(`history/${id}.json`, manifest);
      return id;
    },
    async restore(id) {
      if (DATA_CHECKPOINT.test(id)) {
        const encodedTarget = id.slice(id.indexOf("!") + 1);
        const targetAbs = confineDatasetSource(projectRoot, decodeURIComponent(encodedTarget));
        const bytes = await appState.get(`history/${id}`);
        if (bytes === null) throw new Error(`checkpoint '${id}' has no stored data`);
        await content.writeBytes(targetAbs, bytes);
        return { restoredData: true };
      }
      const text = await appState.getText(`history/${id}.json`);
      if (text === null) throw new Error(`checkpoint '${id}' has no stored manifest`);
      await content.writeText("app/manifest.json", text);
      return { restoredData: false };
    },
  };
}
