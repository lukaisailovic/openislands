/**
 * ContentStore — the port for an app's own content: the manifest, data files
 * (CSV/JSON/Parquet/SQLite/Markdown), SQL transforms, docs, and custom-island
 * code. Consumers reach content only through this port instead of node:fs, so a
 * different backend can serve the same content with zero change to the
 * compiler/runtime call sites. The default adapter is local disk.
 *
 * Two surfaces:
 *   - byte/text I/O for everything read or written from JavaScript;
 *   - a small data-plane bridge for the query engine, which reads files itself.
 *     `sourceUri` is what the engine reads (the local adapter returns a path);
 *     `localPath` materializes a real on-disk file for the cases that need one
 *     (SQLite ATTACH, in-place flat-file appends) and `persistLocal` pushes it
 *     back. On local disk those are the same path and `persistLocal` is a no-op.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { DirEntry, FileStat, QueryConnection } from "./types.js";

export interface ContentStore {
  /** UTF-8 text of a content file, or null if it does not exist. */
  readText(path: string): Promise<string | null>;
  /** Raw bytes of a content file, or null if it does not exist. */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Write UTF-8 text, creating any missing parent directories. */
  writeText(path: string, content: string): Promise<void>;
  /** Write raw bytes, creating any missing parent directories. */
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  /** Whether a content file exists. */
  exists(path: string): Promise<boolean>;
  /** Metadata for a content file, or null if missing. */
  stat(path: string): Promise<FileStat | null>;
  /** Immediate children of a content directory; `[]` if it does not exist. */
  list(path: string): Promise<DirEntry[]>;
  /** Remove a content file; a no-op if it does not exist. */
  remove(path: string): Promise<void>;
  /** Rename/move a content file, creating the destination's parent directories. */
  move(from: string, to: string): Promise<void>;

  // --- query-engine data plane ---------------------------------------------------

  /** The URI the query engine reads a manifest source from (the local adapter returns an absolute path). */
  sourceUri(source: string): string;
  /** Prepare a fresh engine connection for this store (the local adapter sets `file_search_path`). */
  configureEngine(conn: QueryConnection): Promise<void>;
  /** A real on-disk path for a source — materialized first if the backend is remote — for engines/writers that need a file. */
  localPath(source: string): Promise<string>;
  /** Push a locally-mutated file back to the store after an in-place write (local: a no-op). */
  persistLocal(source: string, localFilePath: string): Promise<void>;
  /** A writable URI the engine can COPY a cache artifact to (e.g. a Parquet snapshot). */
  cacheTarget(name: string): Promise<string>;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The default ContentStore: an app's content rooted at a local directory. A path
 * is resolved relative to the root unless already absolute — matching the
 * historical `resolveSourcePath` behaviour the compiler and runtime relied on.
 */
export class LocalContentStore implements ContentStore {
  constructor(private readonly root: string) {}

  private resolve(path: string): string {
    return isAbsolute(path) ? path : join(this.root, path);
  }

  async readText(path: string): Promise<string | null> {
    const abs = this.resolve(path);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const abs = this.resolve(path);
    return existsSync(abs) ? readFileSync(abs) : null;
  }

  async writeText(path: string, content: string): Promise<void> {
    const abs = this.resolve(path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    const abs = this.resolve(path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(this.resolve(path));
  }

  async stat(path: string): Promise<FileStat | null> {
    const abs = this.resolve(path);
    if (!existsSync(abs)) return null;
    const s = statSync(abs);
    return { size: s.size, mtimeMs: s.mtimeMs };
  }

  async list(path: string): Promise<DirEntry[]> {
    const abs = this.resolve(path);
    if (!existsSync(abs)) return [];
    return readdirSync(abs, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
    }));
  }

  async remove(path: string): Promise<void> {
    rmSync(this.resolve(path), { force: true });
  }

  async move(from: string, to: string): Promise<void> {
    const toAbs = this.resolve(to);
    mkdirSync(dirname(toAbs), { recursive: true });
    renameSync(this.resolve(from), toAbs);
  }

  sourceUri(source: string): string {
    return this.resolve(source);
  }

  async configureEngine(conn: QueryConnection): Promise<void> {
    await conn.run(`SET file_search_path=${quoteLiteral(this.root)}`);
  }

  async localPath(source: string): Promise<string> {
    return this.resolve(source);
  }

  async persistLocal(): Promise<void> {
    // The local path is the real file — nothing to push back.
  }

  async cacheTarget(name: string): Promise<string> {
    const dir = join(this.root, "data", "cache");
    mkdirSync(dir, { recursive: true });
    return join(dir, name);
  }
}
