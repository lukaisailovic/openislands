/**
 * AppStateStore — the port for the tool's *own* per-app state, everything that
 * lives under `.openislands/` today: connector tokens + cursor state, rollback
 * snapshots (action history), MCP edit proposals, and manifest checkpoints. It
 * is a flat, namespaced blob store keyed by strings like `connectors/github.json`
 * or `history/ckpt-1700000000.json`.
 *
 * The default adapter is files under `<root>/.openislands/`; a different adapter
 * can map the same keys onto another store (e.g. a database) without changing any
 * caller.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StateEntry } from "./types.js";

export interface AppStateStore {
  /** Raw bytes for a key, or null if absent. */
  get(key: string): Promise<Uint8Array | null>;
  /** UTF-8 text for a key, or null if absent. */
  getText(key: string): Promise<string | null>;
  /** Store bytes or text under a key, creating any namespace as needed. */
  put(key: string, value: Uint8Array | string): Promise<void>;
  /** Delete a key; a no-op if absent. */
  delete(key: string): Promise<void>;
  /** Whether a key exists. */
  exists(key: string): Promise<boolean>;
  /** Objects directly under a prefix (e.g. `history`), with sizes; `[]` if the prefix is empty. */
  list(prefix: string): Promise<StateEntry[]>;
}

const STATE_DIR = ".openislands";

/** The default AppStateStore: blobs under `<root>/.openislands/`. */
export class LocalAppStateStore implements AppStateStore {
  private readonly base: string;

  constructor(root: string) {
    this.base = join(root, STATE_DIR);
  }

  private pathFor(key: string): string {
    return join(this.base, key);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const path = this.pathFor(key);
    return existsSync(path) ? readFileSync(path) : null;
  }

  async getText(key: string): Promise<string | null> {
    const path = this.pathFor(key);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  async put(key: string, value: Uint8Array | string): Promise<void> {
    const path = this.pathFor(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  }

  async delete(key: string): Promise<void> {
    rmSync(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.pathFor(key));
  }

  async list(prefix: string): Promise<StateEntry[]> {
    const dir = this.pathFor(prefix);
    if (!existsSync(dir)) return [];
    const entries: StateEntry[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      entries.push({
        name: entry.name,
        key: prefix ? `${prefix}/${entry.name}` : entry.name,
        size: statSync(join(dir, entry.name)).size,
      });
    }
    return entries;
  }
}
