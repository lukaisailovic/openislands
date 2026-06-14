/**
 * A per-app version store for the `content.editor` island: every write/restore/
 * delete snapshots the file's prior content here first, so an edit is always
 * undoable. The store is a SQLite database at `<projectDir>/.openislands/
 * editor.sqlite`, written through DuckDB's sqlite extension — the same engine
 * the compiler already uses, so the runtime gains no new dependency. Each call
 * attaches the file on a dedicated in-memory connection and detaches when done;
 * saves are human-paced, so per-call open/close costs nothing that matters.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import duckdb from "@duckdb/node-api";

const { DuckDBInstance } = duckdb;

const STORE_DIR = ".openislands";
const STORE_FILE = "editor.sqlite";
const DEFAULT_KEEP = 50;

export interface VersionMeta {
  id: number;
  createdAt: number;
  byteSize: number;
  label?: string;
}

function storePath(projectDir: string): string {
  const dir = join(projectDir, STORE_DIR);
  mkdirSync(dir, { recursive: true });
  return join(dir, STORE_FILE);
}

type Scalar = string | number | bigint | null;

/** Run `fn` against the app's attached version store, creating the table on first use. */
async function withStore<T>(
  projectDir: string,
  fn: (run: (sql: string, params?: Scalar[]) => Promise<unknown>, all: (sql: string, params?: Scalar[]) => Promise<Record<string, unknown>[]>) => Promise<T>,
): Promise<T> {
  const path = storePath(projectDir);
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    await conn.run("INSTALL sqlite; LOAD sqlite;");
    await conn.run(`ATTACH ${quoteLiteral(path)} AS _store (TYPE sqlite)`);
    await conn.run(
      "CREATE TABLE IF NOT EXISTS _store.versions (id BIGINT, path VARCHAR, content VARCHAR, byte_size BIGINT, created_at BIGINT, label VARCHAR)",
    );
    const run = (sql: string, params?: Scalar[]) => conn.run(sql, params);
    const all = async (sql: string, params?: Scalar[]) => {
      const reader = await conn.runAndReadAll(sql, params);
      return reader.getRowObjects() as Record<string, unknown>[];
    };
    const result = await fn(run, all);
    await conn.run("DETACH _store");
    return result;
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

/** Snapshot `content` for `path`, then prune that path's history to the newest `DEFAULT_KEEP`. */
export async function recordVersion(
  projectDir: string,
  path: string,
  content: string,
  label?: string,
): Promise<void> {
  await withStore(projectDir, async (run, all) => {
    const rows = await all("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM _store.versions WHERE path = ?", [path]);
    const nextId = Number(rows[0]?.next ?? 1);
    await run(
      "INSERT INTO _store.versions (id, path, content, byte_size, created_at, label) VALUES (?, ?, ?, ?, ?, ?)",
      [nextId, path, content, Buffer.byteLength(content), Date.now(), label ?? null],
    );
    await prune(run, all, path, DEFAULT_KEEP);
  });
}

/** This path's versions, newest first. */
export async function listVersions(projectDir: string, path: string): Promise<VersionMeta[]> {
  return withStore(projectDir, async (_run, all) => {
    const rows = await all(
      "SELECT id, created_at, byte_size, label FROM _store.versions WHERE path = ? ORDER BY created_at DESC, id DESC",
      [path],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      createdAt: Number(r.created_at),
      byteSize: Number(r.byte_size),
      label: r.label == null ? undefined : String(r.label),
    }));
  });
}

/** The stored content for one version, or null if it no longer exists. */
export async function getVersion(projectDir: string, path: string, id: number): Promise<string | null> {
  return withStore(projectDir, async (_run, all) => {
    const rows = await all("SELECT content FROM _store.versions WHERE path = ? AND id = ?", [path, id]);
    const content = rows[0]?.content;
    return content == null ? null : String(content);
  });
}

/** Delete a path's oldest versions beyond the newest `keep`. */
export async function pruneVersions(projectDir: string, path: string, keep = DEFAULT_KEEP): Promise<void> {
  await withStore(projectDir, (run, all) => prune(run, all, path, keep));
}

async function prune(
  run: (sql: string, params?: Scalar[]) => Promise<unknown>,
  all: (sql: string, params?: Scalar[]) => Promise<Record<string, unknown>[]>,
  path: string,
  keep: number,
): Promise<void> {
  const rows = await all(
    "SELECT id FROM _store.versions WHERE path = ? ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET ?",
    [path, keep],
  );
  const cutoff = rows[0]?.id;
  if (cutoff == null) return;
  await run("DELETE FROM _store.versions WHERE path = ? AND id <= ?", [path, Number(cutoff)]);
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
