/**
 * Rollback checkpoints under `.openislands/history/`. Two kinds share one id
 * space: `ckpt-<ts>` snapshots the manifest (stored as `<id>.json`);
 * `ckpt-<ts>!<encoded-path>` snapshots a data file written by an action
 * (stored under the id verbatim — the id encodes the restore target).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { confineDatasetSource } from "./paths.js";

const MANIFEST_CHECKPOINT_FILE = /^ckpt-\d+\.json$/;
const MANIFEST_CHECKPOINT = /^ckpt-\d+$/;
const DATA_CHECKPOINT = /^ckpt-\d+!.+$/;

export const isCheckpointId = (id: string): boolean => MANIFEST_CHECKPOINT.test(id) || DATA_CHECKPOINT.test(id);

export interface CheckpointStore {
  /** Checkpoint ids, oldest first. */
  list(): string[];
  /** Snapshot the current manifest content; returns the checkpoint id. */
  snapshotManifest(content: string): string;
  /** Restore a checkpoint byte-for-byte; returns whether a data file was touched. */
  restore(id: string): { restoredData: boolean };
}

export function createCheckpointStore(projectRoot: string, manifestPath: string): CheckpointStore {
  const historyDir = join(projectRoot, ".openislands", "history");

  return {
    list() {
      if (!existsSync(historyDir)) return [];
      return readdirSync(historyDir)
        .map((file) => (MANIFEST_CHECKPOINT_FILE.test(file) ? file.slice(0, -".json".length) : file))
        .filter(isCheckpointId)
        .toSorted();
    },
    snapshotManifest(content) {
      mkdirSync(historyDir, { recursive: true });
      const id = `ckpt-${Date.now()}`;
      writeFileSync(join(historyDir, `${id}.json`), content);
      return id;
    },
    restore(id) {
      if (DATA_CHECKPOINT.test(id)) {
        const encodedTarget = id.slice(id.indexOf("!") + 1);
        const targetAbs = confineDatasetSource(projectRoot, decodeURIComponent(encodedTarget));
        writeFileSync(targetAbs, readFileSync(join(historyDir, id)));
        return { restoredData: true };
      }
      writeFileSync(manifestPath, readFileSync(join(historyDir, `${id}.json`), "utf8"));
      return { restoredData: false };
    },
  };
}
