/**
 * Storage-agnostic dataset writers. A dataset's rows land the same way whether
 * it is backed by a flat file (CSV / JSON / NDJSON / JSONL) or a SQLite table —
 * the action and connector write paths resolve a `DatasetWriter` for the target
 * and call `insert` / `replace` without caring which backend is underneath.
 * Derived `sql` datasets have no writer (no physical row sink) and are rejected
 * upstream in the manifest contract.
 *
 * Row validation and rollback snapshots live one layer up (actions.ts) and wrap
 * these writers; a writer only performs the physical mutation. SQLite writes go
 * through DuckDB's sqlite extension (`ATTACH … (TYPE sqlite)`) — the same engine
 * that reads `sqlite_scan` views — so there is one storage engine and no extra
 * runtime dependency.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import duckdb from "@duckdb/node-api";
import { SQLITE_SOURCE_EXTENSIONS } from "@openislands/schema";

const { DuckDBInstance } = duckdb;

/** Where a dataset's rows physically live: a file, plus the table name when that file is a SQLite database. */
export interface WriteTarget {
  /** absolute path to the backing file (flat file or `.sqlite` / `.db`) */
  sourcePath: string;
  /** the SQLite table to write into — required for a sqlite source, ignored otherwise */
  table?: string;
}

/** A row sink for one dataset. `insert` adds rows; `replace` overwrites every row. */
export interface DatasetWriter {
  /** the file whose bytes are snapshotted before a mutation (the rollback unit) */
  readonly path: string;
  /** whether a writable target already exists on disk */
  exists(): boolean;
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
export function resolveWriter(target: WriteTarget): DatasetWriter {
  const ext = extensionOf(target.sourcePath);
  if (SQLITE_SOURCE_EXTENSIONS.includes(ext)) {
    if (!target.table) throw new Error(`sqlite source ${target.sourcePath} needs a 'table' to write into`);
    return new SqliteWriter(target.sourcePath, target.table);
  }
  if (WRITABLE_FILE_EXTENSIONS.includes(ext)) return new FileWriter(target.sourcePath, ext);
  throw new Error(`cannot write '${ext}' — writable: ${[...WRITABLE_FILE_EXTENSIONS, ...SQLITE_SOURCE_EXTENSIONS].join(", ")}`);
}

// --- Flat-file backend ----------------------------------------------------------

class FileWriter implements DatasetWriter {
  constructor(
    readonly path: string,
    private readonly ext: string,
  ) {}

  exists(): boolean {
    return existsSync(this.path);
  }

  async insert(rows: Record<string, unknown>[]): Promise<void> {
    if (!this.exists()) {
      writeNewFile(this.path, this.ext, rows);
      return;
    }
    appendToFile(this.path, this.ext, rows);
  }

  async replace(rows: Record<string, unknown>[]): Promise<void> {
    writeNewFile(this.path, this.ext, rows);
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

function appendLines(sourcePath: string, lines: string[]): void {
  const existing = readFileSync(sourcePath, "utf8");
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(sourcePath, `${existing}${separator}${lines.join("\n")}\n`);
}

function appendCsv(sourcePath: string, header: string[], rows: Record<string, unknown>[]): void {
  appendLines(sourcePath, rows.map((row) => header.map((col) => csvQuote(cellToString(row[col]))).join(",")));
}

function appendNdjson(sourcePath: string, rows: Record<string, unknown>[]): void {
  appendLines(sourcePath, rows.map((row) => JSON.stringify(row)));
}

function appendJsonArray(sourcePath: string, rows: Record<string, unknown>[]): void {
  const parsed = JSON.parse(readFileSync(sourcePath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`cannot append: ${sourcePath} is not a JSON array`);
  parsed.push(...rows);
  writeFileSync(sourcePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

/**
 * Writes rows to a fresh file in the format its extension implies — CSV header
 * from the first row's keys, .json as an array, .ndjson/.jsonl as lines. Used
 * to create a dataset file that doesn't exist yet (e.g. a connector's first sync).
 */
function writeNewFile(sourcePath: string, ext: string, rows: Record<string, unknown>[]): void {
  if (ext === ".json") {
    writeFileSync(sourcePath, `${JSON.stringify(rows, null, 2)}\n`);
    return;
  }
  if (ext === ".ndjson" || ext === ".jsonl") {
    writeFileSync(sourcePath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
    return;
  }
  const header = Object.keys(rows[0] ?? {});
  const lines = [header.map(csvQuote).join(",")];
  for (const row of rows) lines.push(header.map((col) => csvQuote(cellToString(row[col]))).join(","));
  writeFileSync(sourcePath, `${lines.join("\n")}\n`);
}

function appendToFile(sourcePath: string, ext: string, rows: Record<string, unknown>[]): void {
  if (ext === ".csv") {
    const header = parseCsvHeader(readFileSync(sourcePath, "utf8"));
    appendCsv(sourcePath, header, rows);
    return;
  }
  if (ext === ".ndjson" || ext === ".jsonl") {
    appendNdjson(sourcePath, rows);
    return;
  }
  appendJsonArray(sourcePath, rows);
}

// --- SQLite backend -------------------------------------------------------------

/**
 * Inserts into / replaces a SQLite table through DuckDB's sqlite extension. The
 * database file must already exist with the target table (its schema is the
 * dataset's contract); a write never creates one. Each call runs on a dedicated
 * in-memory DuckDB connection that attaches the file read-write, so it never
 * contends with the cached read engine's `sqlite_scan` views.
 */
class SqliteWriter implements DatasetWriter {
  constructor(
    readonly path: string,
    private readonly table: string,
  ) {}

  exists(): boolean {
    return existsSync(this.path);
  }

  async insert(rows: Record<string, unknown>[]): Promise<void> {
    await this.write(rows, { clear: false });
  }

  async replace(rows: Record<string, unknown>[]): Promise<void> {
    await this.write(rows, { clear: true });
  }

  private async write(rows: Record<string, unknown>[], { clear }: { clear: boolean }): Promise<void> {
    if (!this.exists()) {
      throw new Error(`sqlite database not found: ${this.path} — provide the file with table "${this.table}"`);
    }
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    const table = `_w.${quoteIdent(this.table)}`;
    try {
      await conn.run("INSTALL sqlite; LOAD sqlite;");
      await conn.run(`ATTACH ${quoteLiteral(this.path)} AS _w (TYPE sqlite)`);
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
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
