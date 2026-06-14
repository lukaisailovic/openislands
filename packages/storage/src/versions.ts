/**
 * VersionStore — the port for the `content.editor` island's per-file version
 * history (every save/restore/delete snapshots the prior content so an edit is
 * always undoable). Locally this is a SQLite database written through DuckDB
 * (`<root>/.openislands/editor.sqlite`); the DuckDB-backed implementation lives
 * in the runtime so this package stays free of an engine dependency. A different
 * implementation can be swapped in via {@link configureStorage}.
 */
import type { VersionMeta } from "./types.js";

export interface VersionStore {
  /** Snapshot `content` for `path`, then prune that path's history to the newest `keep`. */
  record(path: string, content: string, label?: string): Promise<void>;
  /** This path's versions, newest first. */
  list(path: string): Promise<VersionMeta[]>;
  /** The stored content for one version, or null if it no longer exists. */
  get(path: string, id: number): Promise<string | null>;
  /** Re-key a path's versions so history follows a moved/renamed file. */
  move(from: string, to: string): Promise<void>;
  /** Delete a path's oldest versions beyond the newest `keep`. */
  prune(path: string, keep?: number): Promise<void>;
}
