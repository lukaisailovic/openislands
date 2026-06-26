/**
 * Storage-agnostic dataset writers. A dataset's rows land the same way whether
 * it is backed by a flat file (CSV / JSON / NDJSON / JSONL) or a SQLite table —
 * the action and connector write paths resolve a `DatasetWriter` for the target
 * and call `insert` / `replace` without caring which backend is underneath.
 * Derived `sql` datasets have no writer (no physical row sink) and are rejected
 * upstream in the manifest contract.
 *
 * All file I/O goes through a `ContentStore` (writers never touch `node:fs`), so
 * the same rows land wherever the configured adapter keeps them. Flat-file
 * appends are pure string transforms over the
 * current content; SQLite writes materialize a local file (`localPath`), write
 * through DuckDB's sqlite extension, then push the file back (`persistLocal`).
 *
 * Row validation and rollback snapshots live one layer up (actions.ts) and wrap
 * these writers; a writer only performs the physical mutation.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import duckdb from "@duckdb/node-api";
import { SQLITE_SOURCE_EXTENSIONS } from "@openislands/schema";
import type { ContentStore } from "@openislands/storage";

const { DuckDBInstance } = duckdb;

const DUCKDB_TEMP_DIRECTORY = join(tmpdir(), "openislands-duckdb");

/**
 * In-memory DuckDB instance with an explicit, writable spill directory. Without an
 * explicit temp_directory DuckDB spills to ./.tmp relative to the process cwd, which
 * fails the moment a query spills to disk and the cwd isn't writable (e.g. WORKDIR
 * /app owned by root in the Docker image: "IO Error: Failed to create directory .tmp").
 */
export function createInMemoryDuckDB(): Promise<InstanceType<typeof DuckDBInstance>> {
  return DuckDBInstance.create(":memory:", { temp_directory: DUCKDB_TEMP_DIRECTORY });
}

/** Where a dataset's rows physically live: its content source, plus the table name when that source is a SQLite database. */
export interface WriteTarget {
  /** the dataset name the rows belong to — the unit the engine re-registers after the write */
  dataset: string;
  /** the dataset's source within the content store (relative or absolute) */
  source: string;
  /** the SQLite table to write into — required for a sqlite source, ignored otherwise */
  table?: string;
}

/** A row sink for one dataset. `insert` adds rows; `replace` overwrites every row. */
export interface DatasetWriter {
  /** the source whose bytes are snapshotted before a mutation (the rollback unit) */
  readonly path: string;
  /** whether a writable target already exists */
  exists(): Promise<boolean>;
  insert(rows: Record<string, unknown>[]): Promise<void>;
  replace(rows: Record<string, unknown>[]): Promise<void>;
}

/** Flat-file formats a writer can append rows to (a SQLite table is the other writable target). */
const WRITABLE_FILE_EXTENSIONS = [".csv", ".json", ".ndjson", ".jsonl"];

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

/** Picks the writer for a target by its source extension; throws for a format with no sink. */
export function resolveWriter(store: ContentStore, target: WriteTarget): DatasetWriter {
  const ext = extensionOf(target.source);
  if (SQLITE_SOURCE_EXTENSIONS.includes(ext)) {
    if (!target.table) throw new Error(`sqlite source ${target.source} needs a 'table' to write into`);
    return new SqliteWriter(store, target.source, target.table);
  }
  if (WRITABLE_FILE_EXTENSIONS.includes(ext)) return new FileWriter(store, target.source, ext);
  throw new Error(`cannot write '${ext}' — writable: ${[...WRITABLE_FILE_EXTENSIONS, ...SQLITE_SOURCE_EXTENSIONS].join(", ")}`);
}

// --- Flat-file backend ----------------------------------------------------------

class FileWriter implements DatasetWriter {
  constructor(
    private readonly store: ContentStore,
    readonly path: string,
    private readonly ext: string,
  ) {}

  async exists(): Promise<boolean> {
    return this.store.exists(this.path);
  }

  async insert(rows: Record<string, unknown>[]): Promise<void> {
    const existing = await this.store.readText(this.path);
    if (existing === null) {
      await this.store.writeText(this.path, renderNewFile(this.ext, rows));
      return;
    }
    await this.store.writeText(this.path, appendContent(existing, this.ext, rows));
  }

  async replace(rows: Record<string, unknown>[]): Promise<void> {
    await this.store.writeText(this.path, renderNewFile(this.ext, rows));
  }
}

function csvQuote(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function parseCsvHeader(content: string): string[] {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  return parseCsvLine(firstLine);
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

/** The full new content after appending `rows` to `existing`, in the format `ext` implies. */
function appendContent(existing: string, ext: string, rows: Record<string, unknown>[]): string {
  if (ext === ".csv") {
    const header = parseCsvHeader(existing);
    return appendLines(existing, rows.map((row) => header.map((col) => csvQuote(cellToString(row[col]))).join(",")));
  }
  if (ext === ".ndjson" || ext === ".jsonl") {
    return appendLines(existing, rows.map((row) => JSON.stringify(row)));
  }
  const parsed = JSON.parse(existing);
  if (!Array.isArray(parsed)) throw new Error("cannot append: source is not a JSON array");
  parsed.push(...rows);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function appendLines(existing: string, lines: string[]): string {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const separator = existing.length > 0 && !existing.endsWith(eol) ? eol : "";
  return `${existing}${separator}${lines.join(eol)}${eol}`;
}

/**
 * Renders rows as a fresh file in the format its extension implies — CSV header
 * from the first row's keys, .json as an array, .ndjson/.jsonl as lines. Used to
 * create a dataset file that doesn't exist yet (e.g. a connector's first sync).
 */
function renderNewFile(ext: string, rows: Record<string, unknown>[]): string {
  if (ext === ".json") return `${JSON.stringify(rows, null, 2)}\n`;
  if (ext === ".ndjson" || ext === ".jsonl") return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  const header = Object.keys(rows[0] ?? {});
  const lines = [header.map(csvQuote).join(",")];
  for (const row of rows) lines.push(header.map((col) => csvQuote(cellToString(row[col]))).join(","));
  return `${lines.join("\n")}\n`;
}

// --- SQLite backend -------------------------------------------------------------

/**
 * Inserts into / replaces a SQLite table through DuckDB's sqlite extension. The
 * database file must already exist with the target table (its schema is the
 * dataset's contract); a write never creates one. The store hands back a real
 * on-disk path to attach (downloaded first when the store is remote), and the
 * mutated file is pushed back afterwards via `persistLocal`. Each call runs on a
 * dedicated in-memory DuckDB connection that attaches read-write, so it never
 * contends with the cached read engine's `sqlite_scan` views.
 */
class SqliteWriter implements DatasetWriter {
  constructor(
    private readonly store: ContentStore,
    readonly path: string,
    private readonly table: string,
  ) {}

  async exists(): Promise<boolean> {
    return this.store.exists(this.path);
  }

  async insert(rows: Record<string, unknown>[]): Promise<void> {
    await this.write(rows, { clear: false });
  }

  async replace(rows: Record<string, unknown>[]): Promise<void> {
    await this.write(rows, { clear: true });
  }

  private async write(rows: Record<string, unknown>[], { clear }: { clear: boolean }): Promise<void> {
    if (!(await this.exists())) {
      throw new Error(`sqlite database not found: ${this.path} — provide the file with table "${this.table}"`);
    }
    const localFile = await this.store.localPath(this.path);
    const instance = await createInMemoryDuckDB();
    const conn = await instance.connect();
    const table = `_w.${quoteIdent(this.table)}`;
    try {
      await conn.run("INSTALL sqlite; LOAD sqlite;");
      await conn.run(`ATTACH ${quoteLiteral(localFile)} AS _w (TYPE sqlite)`);
      await conn.run("BEGIN");
      if (clear) await conn.run(`DELETE FROM ${table}`);
      if (rows.length > 0) {
        const columns = Object.keys(rows[0]!);
        const columnList = columns.map(quoteIdent).join(", ");
        const placeholders = `(${columns.map(() => "?").join(", ")})`;
        for (const row of rows) {
          const values = columns.map((col) => row[col] as string | number | boolean | bigint | null);
          await conn.run(`INSERT INTO ${table} (${columnList}) VALUES ${placeholders}`, values);
        }
      }
      await conn.run("COMMIT");
      await conn.run("DETACH _w");
    } finally {
      conn.closeSync();
      instance.closeSync();
    }
    await this.store.persistLocal(this.path, localFile);
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
