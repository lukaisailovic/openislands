/**
 * Shared value types for the storage ports. Kept dependency-free (structural
 * only) so the storage package pulls in nothing — an alternate adapter can
 * implement these against another backend without dragging DuckDB or schema along.
 */

/** Metadata for a content file. */
export interface FileStat {
  /** size in bytes */
  size: number;
  /** last-modified time, epoch milliseconds */
  mtimeMs: number;
}

/** One entry in a content directory listing. */
export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

/** One stored object in an {@link AppStateStore} listing. */
export interface StateEntry {
  /** the bare object name within the listed prefix, e.g. `ckpt-1700000000.json` */
  name: string;
  /** the full store key, usable with get/put/delete, e.g. `history/ckpt-1700000000.json` */
  key: string;
  /** size in bytes */
  size: number;
}

/** A stored version of an editor file. */
export interface VersionMeta {
  id: number;
  createdAt: number;
  byteSize: number;
  label?: string;
}

/**
 * The minimal query-engine connection a {@link ContentStore} needs to wire its
 * data plane: run a setup statement (file search path, extensions, secrets).
 * DuckDB's connection satisfies this structurally — keeping it structural means
 * the storage package never depends on the engine.
 */
export interface QueryConnection {
  run(sql: string): Promise<unknown>;
}
