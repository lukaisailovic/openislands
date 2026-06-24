/**
 * @openislands/compiler — the native DuckDB query core. It turns local files
 * into typed data contracts and runs read-only queries/transforms over the
 * live project files. The contract check is what makes the dashboard "fail
 * loudly" instead of silently rendering a wrong chart.
 *
 * One engine per project: an in-memory DuckDB instance that registers each
 * manifest dataset as a view (file sources via read_csv_auto/read_json_auto/
 * read_parquet, `sql` datasets as views over a models/*.sql file, markdown
 * datasets via a pre-parsed JSON view). The runtime queries these views live;
 * `compile` reuses them for the contract check.
 */
import { join, extname, basename, isAbsolute } from "node:path";
import duckdb, { type DuckDBValue } from "@duckdb/node-api";
import { type ContentStore, getContentStore, isHiddenPath, resolveWithinRoot } from "@openislands/storage";
import { BUILTIN_ISLAND_TYPES, flattenPageIslands, isSqliteSource, lintManifest, validateManifest, type Manifest, type DatasetSpec, type IslandError, type IslandType } from "@openislands/schema";
import { queryResultToArrowIPC } from "./arrow.js";
import { checkCustomIsland } from "./customSchema.js";
import { checkConnectors } from "./connectors.js";
import { checkQueries } from "./queries.js";

export { queryResultToArrowIPC } from "./arrow.js";
export { migrateApp } from "./migrate.js";
export {
  checkCustomIsland,
  customIslandDir,
  customSchemaFile,
  resetCustomSchemaCache,
  type CustomIslandError,
} from "./customSchema.js";
export {
  actionRowSchema,
  actionFields,
  insertRows,
  insertValidatedRows,
  replaceValidatedRows,
  datasetRowSchema,
  validateRows,
  ActionValidationError,
  MAX_SNAPSHOTS_PER_FILE,
  MAX_SNAPSHOT_BYTES_PER_FILE,
  type ActionField,
  type RetentionOpts,
  type RowError,
  type InsertResult,
  type ReplaceResult,
  type ValidatedRows,
} from "./actions.js";
export { resolveWriter, extensionOf, type DatasetWriter, type WriteTarget } from "./writers.js";
export {
  listConnectorStatuses,
  runConnectorSync,
  getConnectorAuthorizeUrl,
  completeConnectorOAuth,
  hasPendingOAuthState,
  disconnectConnector,
  checkConnectors,
  parseSchedule,
  resetConnectorCache,
  clearConnectorState,
  type ConnectorStatus,
  type SyncResult,
  type ConnectorValidationError,
} from "./connectors.js";
export {
  runQuery,
  queryColumns,
  queryParamSchema,
  validateParams,
  checkQueries,
  buildQuerySql,
  QueryValidationError,
  type QueryRunResult,
  type ParamError,
  type QueryContractError,
} from "./queries.js";

const { DuckDBInstance, DuckDBTypeId, StatementType } = duckdb;
type DuckDBConnection = Awaited<ReturnType<InstanceType<typeof DuckDBInstance>["connect"]>>;

export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
export type ColumnType = "number" | "date" | "boolean" | "string";

export interface Column {
  name: string;
  type: ColumnType;
}

export interface QueryResult {
  columns: Column[];
  rows: Row[];
}

export interface SourceSchema {
  dataset: string;
  columns: Column[];
}

export interface Snapshot {
  dataset: string;
  columns: Column[];
  rows: Row[];
}

export interface IslandCheck {
  page: string;
  index: number;
  type: string;
  dataset?: string;
  ok: boolean;
  missingFields: string[];
}

export interface CompileReport {
  ok: boolean;
  manifest?: Manifest;
  snapshots: Record<string, Snapshot>;
  islandChecks: IslandCheck[];
  errors: string[];
  warnings: string[];
  /** schema-level island errors (fail loudly, named) */
  manifestErrors: IslandError[];
}

const DEFAULT_ROW_CAP = 10_000;

// --- The per-project engine -----------------------------------------------------

interface Engine {
  conn: DuckDBConnection;
  manifest: Manifest;
  registered: Set<string>;
  /** Datasets that failed to register, mapped to the real reason. A failed dataset
   * no longer aborts the whole engine — healthy siblings still register, and the
   * captured message surfaces instead of a blanket "unknown or unreadable". */
  failures: Map<string, string>;
}

const engines = new Map<string, Promise<Engine>>();

const MANIFEST_REL = "manifest.json";

function manifestPathFor(projectDir: string): string {
  return join(projectDir, MANIFEST_REL);
}

export async function readManifest(projectDir: string): Promise<Manifest> {
  const raw = await getContentStore(projectDir).readText(MANIFEST_REL);
  if (raw === null) throw new Error(`no manifest at ${manifestPathFor(projectDir)}`);
  const validation = validateManifest(JSON.parse(raw));
  if (!validation.ok || !validation.manifest) {
    const first = validation.errors[0];
    throw new Error(`invalid manifest: ${first ? first.message : "unknown error"}`);
  }
  return validation.manifest;
}

/** Register every dataset of a manifest onto a connection, isolating per-dataset failures
 * so one bad source or transform can't blind the rest (it lands in `failures`, not a throw). */
async function registerDatasets(
  projectDir: string,
  conn: DuckDBConnection,
  store: ContentStore,
  manifest: Manifest,
): Promise<{ registered: Set<string>; failures: Map<string, string> }> {
  const specs = Object.values(manifest.datasets);
  if (specs.some((spec) => spec.source && isSqliteSource(spec.source))) {
    await conn.run("INSTALL sqlite; LOAD sqlite;");
  }
  const registered = new Set<string>();
  const failures = new Map<string, string>();
  for (const [name, spec] of Object.entries(manifest.datasets)) {
    try {
      await registerDataset(projectDir, conn, store, name, spec);
      registered.add(name);
    } catch (e) {
      failures.set(name, (e as Error).message);
    }
  }
  return { registered, failures };
}

async function buildEngine(projectDir: string): Promise<Engine> {
  const store = getContentStore(projectDir);
  const manifest = await readManifest(projectDir);
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await store.configureEngine(conn);
  const { registered, failures } = await registerDatasets(projectDir, conn, store, manifest);
  return { conn, manifest, registered, failures };
}

function getEngine(projectDir: string): Promise<Engine> {
  const existing = engines.get(projectDir);
  if (existing) return existing;
  const created = buildEngine(projectDir);
  engines.set(projectDir, created);
  return created;
}

/** Drops the cached engine so the next call re-reads the manifest and files. */
export function resetEngine(projectDir: string): void {
  engines.delete(projectDir);
}

/** Why a dataset isn't queryable: its real registration failure if it had one, else just unknown. */
function unavailableDataset(engine: Engine, dataset: string): Error {
  return new Error(engine.failures.get(dataset) ?? `unknown dataset '${dataset}'`);
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function resolveSourcePath(projectDir: string, source: string): string {
  return isAbsolute(source) ? source : join(projectDir, source);
}

/**
 * Confine a manifest-declared `source`/`sql` path before the query engine reads it. The manifest
 * validates these only as free strings, so without this a malicious/downloaded manifest could point
 * a dataset at `/etc/passwd`, `../secret`, a dotfile like `.env`, or a symlink out of the root, and
 * have DuckDB read it via read_csv_auto/read_text. The floor is "stays in the project and isn't a
 * secret" — not a dir allowlist (in-root files are the user's own project; the MCP applies the
 * stricter source-dir policy at write time). Throws on escape; the per-dataset catch in
 * registerDatasets turns it into a named registration failure.
 */
function confineSource(projectDir: string, source: string): void {
  const confined = resolveWithinRoot(projectDir, source);
  if (!confined) throw new Error(`source '${source}' resolves outside the project root`);
  if (isHiddenPath(confined.rel)) throw new Error(`source '${source}' targets a protected file`);
}

function sourceExtension(source: string): string {
  return extname(source.split("*")[0] ?? source).toLowerCase();
}

function fileReaderExpr(source: string, uri: string): string {
  const lit = quoteLiteral(uri);
  const ext = sourceExtension(source);
  switch (ext) {
    case ".csv":
      return `read_csv_auto(${lit})`;
    case ".json":
    case ".ndjson":
      return `read_json_auto(${lit})`;
    case ".parquet":
      return `read_parquet(${lit})`;
    case ".sqlite":
    case ".db":
      throw new Error(`sqlite source ${source} can only be read through a dataset declaring its 'table'`);
    default:
      throw new Error(`unsupported source type '${ext}' for ${source}`);
  }
}

async function registerDataset(projectDir: string, conn: DuckDBConnection, store: ContentStore, name: string, spec: DatasetSpec): Promise<void> {
  const view = quoteIdent(name);
  if (spec.sql) {
    confineSource(projectDir, spec.sql);
    const body = await store.readText(spec.sql);
    if (body === null) throw new Error(`dataset '${name}': sql transform not found: ${spec.sql}`);
    await conn.run(`CREATE VIEW ${view} AS ${body.trim().replace(/;\s*$/, "")}`);
    return;
  }
  if (!spec.source) throw new Error(`dataset '${name}': no source`);
  confineSource(projectDir, spec.source);
  const ext = sourceExtension(spec.source);
  if (ext === ".md" || ext === ".markdown") {
    await registerMarkdownDataset(conn, store, name, spec.source);
    return;
  }
  if (isSqliteSource(spec.source)) {
    if (!spec.table) throw new Error(`dataset '${name}': a sqlite source needs a 'table'`);
    if (!(await store.exists(spec.source))) throw new Error(`dataset '${name}': source not found: ${spec.source}`);
    const path = await store.localPath(spec.source);
    await conn.run(`CREATE VIEW ${view} AS SELECT * FROM sqlite_scan(${quoteLiteral(path)}, ${quoteLiteral(spec.table)})`);
    return;
  }
  if (!spec.source.includes("*") && !(await store.exists(spec.source))) throw new Error(`dataset '${name}': source not found: ${spec.source}`);
  await conn.run(`CREATE VIEW ${view} AS SELECT * FROM ${fileReaderExpr(spec.source, store.sourceUri(spec.source))}`);
}

// --- Markdown datasets ----------------------------------------------------------

interface MarkdownRow {
  file: string;
  body: string;
  [key: string]: Scalar;
}

function parseFrontMatter(text: string): { data: Record<string, Scalar>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text.trim() };
  const data: Record<string, Scalar> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    if (!key) continue;
    data[key] = coerceScalar(line.slice(sep + 1).trim());
  }
  return { data, body: (match[2] ?? "").trim() };
}

function coerceScalar(raw: string): Scalar {
  const v = raw.replace(/^["']|["']$/g, "").trim();
  if (v === "") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function scalarToSql(value: Scalar): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return quoteLiteral(value);
}

async function registerMarkdownDataset(conn: DuckDBConnection, store: ContentStore, name: string, source: string): Promise<void> {
  const text = await store.readText(source);
  if (text === null) throw new Error(`dataset '${name}': markdown source not found: ${source}`);
  const { data, body } = parseFrontMatter(text);
  const row: MarkdownRow = { file: basename(source), body, ...data };
  const keys = Object.keys(row);
  const cols = keys.map(quoteIdent).join(", ");
  const values = keys.map((k) => scalarToSql(row[k]!)).join(", ");
  await conn.run(`CREATE VIEW ${quoteIdent(name)} AS SELECT * FROM (VALUES (${values})) AS _md(${cols})`);
}

// --- DuckDB value + type mapping ------------------------------------------------

function mapTypeId(typeId: number): ColumnType {
  switch (typeId) {
    case DuckDBTypeId.BOOLEAN:
      return "boolean";
    case DuckDBTypeId.TINYINT:
    case DuckDBTypeId.SMALLINT:
    case DuckDBTypeId.INTEGER:
    case DuckDBTypeId.BIGINT:
    case DuckDBTypeId.HUGEINT:
    case DuckDBTypeId.UTINYINT:
    case DuckDBTypeId.USMALLINT:
    case DuckDBTypeId.UINTEGER:
    case DuckDBTypeId.UBIGINT:
    case DuckDBTypeId.UHUGEINT:
    case DuckDBTypeId.FLOAT:
    case DuckDBTypeId.DOUBLE:
    case DuckDBTypeId.DECIMAL:
      return "number";
    case DuckDBTypeId.DATE:
    case DuckDBTypeId.TIME:
    case DuckDBTypeId.TIME_TZ:
    case DuckDBTypeId.TIMESTAMP:
    case DuckDBTypeId.TIMESTAMP_TZ:
    case DuckDBTypeId.TIMESTAMP_S:
    case DuckDBTypeId.TIMESTAMP_MS:
    case DuckDBTypeId.TIMESTAMP_NS:
      return "date";
    default:
      return "string";
  }
}

function toScalar(value: unknown): Scalar {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  const obj = value as { toDouble?: () => number; toString?: () => string };
  if (typeof obj.toDouble === "function") return obj.toDouble();
  if (typeof obj.toString === "function") return obj.toString();
  return String(value);
}

function columnsFromReader(reader: { columnNames(): string[]; columnTypes(): { typeId: number }[] }): Column[] {
  const names = reader.columnNames();
  const types = reader.columnTypes();
  return names.map((name, i) => ({ name, type: mapTypeId(types[i]!.typeId) }));
}

function rowsFromReader(reader: { getRowObjects(): Record<string, unknown>[] }): Row[] {
  return reader.getRowObjects().map((raw) => {
    const out: Row = {};
    for (const key of Object.keys(raw)) out[key] = toScalar(raw[key]);
    return out;
  });
}

// --- Read-only guard ------------------------------------------------------------

async function assertReadOnly(conn: DuckDBConnection, sql: string): Promise<void> {
  const extracted = await conn.extractStatements(sql);
  if (extracted.count === 0) throw new Error("empty query");
  if (extracted.count > 1) throw new Error("only a single read-only statement is allowed");
  const prepared = await extracted.prepare(0);
  const type = prepared.statementType;
  prepared.destroySync();
  if (type !== StatementType.SELECT) throw new Error(`only read-only SELECT queries are allowed (got ${StatementType[type]})`);
}

/**
 * Confine an ad-hoc SELECT to the registered dataset views — the contract `run_sql` advertises.
 * `assertReadOnly` gates the statement TYPE; this gates what it may READ. DuckDB exposes the
 * filesystem two ways inside a SELECT: table functions (`read_text`/`read_csv_auto`/`read_blob`,
 * which also reach the network via httpfs) and replacement scans (`FROM '/etc/passwd'`, which
 * parse as a base table whose name is the path). We reject every table function and every base
 * table that isn't a registered view or a CTE defined in the same statement, so a free-form
 * query can't be turned into an arbitrary-file-read / SSRF gadget. Operates on DuckDB's own
 * parse tree (via `json_serialize_sql`), so comments/casing/whitespace can't smuggle past it.
 */
async function assertReferencesOnlyViews(conn: DuckDBConnection, sql: string, registered: Set<string>): Promise<void> {
  const reader = await conn.runAndReadAll(`SELECT json_serialize_sql(${quoteLiteral(sql)}) AS j`);
  const ast = JSON.parse(String(reader.getRows()[0]![0])) as unknown;
  const baseTables: string[] = [];
  const cteKeys = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "TABLE_FUNCTION") {
      throw new Error("table functions are not allowed here — query the registered dataset views by name");
    }
    if (obj.type === "BASE_TABLE" && typeof obj.table_name === "string") baseTables.push(obj.table_name);
    const cteMap = obj.cte_map as { map?: { key?: unknown }[] } | undefined;
    if (cteMap?.map) for (const e of cteMap.map) if (typeof e.key === "string") cteKeys.add(e.key.toLowerCase());
    for (const value of Object.values(obj)) walk(value);
  };
  walk(ast);
  const allowed = new Set([...registered].map((v) => v.toLowerCase()));
  for (const table of baseTables) {
    const name = table.toLowerCase();
    if (!allowed.has(name) && !cteKeys.has(name)) {
      throw new Error(`'${table}' is not a known dataset — ad-hoc SQL can only read the registered dataset views`);
    }
  }
}

// --- Public query API -----------------------------------------------------------

/** A date-range narrowing applied at query time, from a page-level filter. */
export interface QueryRange {
  field: string;
  from?: string;
  to?: string;
}

/** An equality narrowing applied at query time, e.g. a drilldown filtered to a clicked row. */
export interface QueryMatch {
  field: string;
  value: string;
}

/** An equality / set-membership narrowing from a page-level select filter. */
export interface QuerySelect {
  field: string;
  values: string[];
}

export interface QueryOpts {
  limit?: number;
  range?: QueryRange;
  match?: QueryMatch[];
  select?: QuerySelect[];
}

/**
 * Builds the WHERE clause for a range over a verified column. SECURITY: `field`
 * must already be confirmed to exist in the dataset (caller's job) before it
 * reaches here, since it is interpolated as a quoted identifier; `from`/`to` go
 * in as prepared-statement parameters.
 *
 * A DATE/TIMESTAMP column casts the param so the comparison is typed. A VARCHAR
 * column compares as strings, but the bound is first truncated to the column
 * value's own length (`LEFT(?, length(col))`). That keeps coarser-granularity
 * values robust: a 'YYYY-MM' month string is matched against the YYYY-MM prefix
 * of the YYYY-MM-DD bound, so a `from`/`to` inside a month still includes it;
 * full YYYY-MM-DD strings compare unchanged (LEFT over their full length).
 */
function rangeClause(column: Column, range: QueryRange): { sql: string; params: string[] } {
  const ident = quoteIdent(column.name);
  const bound = (op: string) => (column.type === "date" ? `${ident} ${op} ?::TIMESTAMP` : `${ident} ${op} LEFT(?, length(${ident}))`);
  const conds: string[] = [];
  const params: string[] = [];
  if (range.from !== undefined) {
    conds.push(bound(">="));
    params.push(range.from);
  }
  if (range.to !== undefined) {
    conds.push(bound("<="));
    params.push(range.to);
  }
  return { sql: conds.join(" AND "), params };
}

/** Runs a dataset's view read-only over the live files and returns JSON-able rows. */
export async function query(projectDir: string, dataset: string, opts?: QueryOpts): Promise<QueryResult> {
  const engine = await getEngine(projectDir);
  if (!engine.registered.has(dataset)) throw unavailableDataset(engine, dataset);
  const limit = opts?.limit ?? DEFAULT_ROW_CAP;
  const view = quoteIdent(dataset);

  const hasRange = !!opts?.range && (opts.range.from !== undefined || opts.range.to !== undefined);
  const hasMatch = !!opts?.match && opts.match.length > 0;
  const hasSelect = !!opts?.select && opts.select.some((s) => s.values.length > 0);
  if (!hasRange && !hasMatch && !hasSelect) return runSelect(engine.conn, `SELECT * FROM ${view}`, limit);

  const columns = await datasetColumns(engine.conn, dataset);
  const conds: string[] = [];
  const params: string[] = [];

  if (hasRange) {
    const column = verifyField(columns, dataset, opts!.range!.field, "range field");
    const clause = rangeClause(column, opts!.range!);
    if (clause.sql) {
      conds.push(clause.sql);
      params.push(...clause.params);
    }
  }
  if (hasMatch) {
    for (const { field, value } of opts!.match!) {
      const column = verifyField(columns, dataset, field, "match field");
      conds.push(`CAST(${quoteIdent(column.name)} AS VARCHAR) = ?`);
      params.push(value);
    }
  }
  if (hasSelect) {
    for (const { field, values } of opts!.select!) {
      const present = values.filter((v) => v.length > 0);
      if (present.length === 0) continue;
      const column = verifyField(columns, dataset, field, "select field");
      const ident = `CAST(${quoteIdent(column.name)} AS VARCHAR)`;
      if (present.length === 1) {
        conds.push(`${ident} = ?`);
        params.push(present[0]!);
      } else {
        conds.push(`${ident} IN (${present.map(() => "?").join(", ")})`);
        params.push(...present);
      }
    }
  }

  if (conds.length === 0) return runSelect(engine.conn, `SELECT * FROM ${view}`, limit);
  const capped = Math.max(0, Math.floor(limit));
  const reader = await engine.conn.runAndReadAll(`SELECT * FROM ${view} WHERE ${conds.join(" AND ")} LIMIT ${capped}`, params);
  return { columns: columnsFromReader(reader), rows: rowsFromReader(reader) };
}

/** A dataset's live column set via a zero-row query — the basis for verifying interpolated identifiers. */
async function datasetColumns(conn: DuckDBConnection, dataset: string): Promise<Column[]> {
  const reader = await conn.runAndReadAll(`SELECT * FROM ${quoteIdent(dataset)} LIMIT 0`);
  return columnsFromReader(reader);
}

/** Confirms a field exists in the dataset's live schema before it's interpolated as a quoted identifier. */
function verifyField(columns: Column[], dataset: string, field: string, what: string): Column {
  const column = columns.find((c) => c.name === field);
  if (!column) throw new Error(`${what} '${field}' not found in dataset '${dataset}'`);
  return column;
}

/** Runs a dataset query and serializes the result as an Arrow IPC stream (zero-copy on the client). */
export async function queryArrow(projectDir: string, dataset: string, opts?: QueryOpts): Promise<Uint8Array> {
  const result = await query(projectDir, dataset, opts);
  return queryResultToArrowIPC(result);
}

/** Runs an arbitrary read-only SELECT against the project's registered views. */
export async function queryRaw(projectDir: string, sql: string, opts?: { limit?: number }): Promise<QueryResult> {
  const engine = await getEngine(projectDir);
  await assertReadOnly(engine.conn, sql);
  await assertReferencesOnlyViews(engine.conn, sql, engine.registered);
  return runSelect(engine.conn, sql, opts?.limit ?? DEFAULT_ROW_CAP);
}

async function runSelect(conn: DuckDBConnection, sql: string, limit: number): Promise<QueryResult> {
  const capped = `SELECT * FROM (${sql}) AS _capped LIMIT ${Math.max(0, Math.floor(limit))}`;
  const reader = await conn.runAndReadAll(capped);
  return { columns: columnsFromReader(reader), rows: rowsFromReader(reader) };
}

// --- Declared queries: run a generated parameterized SELECT ----------------------

/** Runs a read-only SELECT with named params bound as prepared-statement values, row-capped. The named-param sibling of queryRaw; the query builder in queries.ts generates the SQL it runs. */
export async function queryWithParams(
  projectDir: string,
  sql: string,
  params?: Record<string, unknown>,
  opts?: { limit?: number },
): Promise<QueryResult> {
  const engine = await getEngine(projectDir);
  await assertReadOnly(engine.conn, sql);
  const trimmed = sql.trim().replace(/;\s*$/, "");
  const cap = Math.max(0, Math.floor(opts?.limit ?? DEFAULT_ROW_CAP));
  const capped = `SELECT * FROM (${trimmed}) AS _q LIMIT ${cap}`;
  const reader =
    params && Object.keys(params).length > 0
      ? await engine.conn.runAndReadAll(capped, params as Record<string, DuckDBValue>)
      : await engine.conn.runAndReadAll(capped);
  return { columns: columnsFromReader(reader), rows: rowsFromReader(reader) };
}

/**
 * Dry-run a read-only SELECT against the project's registered dataset views WITHOUT
 * returning data — the agent's way to author a `sql` transform body and confirm it
 * binds before wiring it into a dataset. Returns the result columns on success, or
 * the exact DuckDB error (catalog / parse / type) on failure.
 */
export async function validateSql(
  projectDir: string,
  sql: string,
): Promise<{ ok: true; columns: Column[] } | { ok: false; error: string }> {
  const engine = await getEngine(projectDir);
  try {
    await assertReadOnly(engine.conn, sql);
    const trimmed = sql.trim().replace(/;\s*$/, "");
    const reader = await engine.conn.runAndReadAll(`SELECT * FROM (${trimmed}) AS _validate LIMIT 0`);
    return { ok: true, columns: columnsFromReader(reader) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** A column's distinct non-null values, sorted and row-capped — populates a select filter's options when the manifest omits them. The column is verified before it is interpolated. */
export async function distinctValues(projectDir: string, dataset: string, column: string, opts?: { limit?: number }): Promise<string[]> {
  const engine = await getEngine(projectDir);
  if (!engine.registered.has(dataset)) throw unavailableDataset(engine, dataset);
  const columns = await datasetColumns(engine.conn, dataset);
  const col = verifyField(columns, dataset, column, "distinct column");
  const capped = Math.max(0, Math.floor(opts?.limit ?? DEFAULT_ROW_CAP));
  const ident = quoteIdent(col.name);
  const reader = await engine.conn.runAndReadAll(
    `SELECT DISTINCT CAST(${ident} AS VARCHAR) AS v FROM ${quoteIdent(dataset)} WHERE ${ident} IS NOT NULL ORDER BY 1 LIMIT ${capped}`,
  );
  return reader.getRowObjects().map((r) => String(r.v));
}

/** Columns + types of a dataset (or raw file path) via a zero-row query. */
export async function inferSchema(projectDir: string, datasetOrFile: string): Promise<SourceSchema> {
  const engine = await getEngine(projectDir);
  if (engine.registered.has(datasetOrFile)) {
    const reader = await engine.conn.runAndReadAll(`SELECT * FROM ${quoteIdent(datasetOrFile)} LIMIT 0`);
    return { dataset: datasetOrFile, columns: columnsFromReader(reader) };
  }
  if (engine.failures.has(datasetOrFile)) throw unavailableDataset(engine, datasetOrFile);
  confineSource(projectDir, datasetOrFile);
  const uri = getContentStore(projectDir).sourceUri(datasetOrFile);
  const reader = await engine.conn.runAndReadAll(`SELECT * FROM ${fileReaderExpr(datasetOrFile, uri)} LIMIT 0`);
  return { dataset: datasetOrFile, columns: columnsFromReader(reader) };
}

/**
 * Resolve a *proposed* manifest's datasets to their live columns — and the real reason any
 * failed — using a throwaway in-memory engine, NOT the cached on-disk one. This is what lets
 * the MCP server validate a manifest that introduces brand-new datasets (a CSV, a `sql`
 * transform, a markdown doc) before it is ever written to disk: the on-disk engine wouldn't
 * know about them yet, which is why a fresh dataset used to come back "unknown or unreadable".
 */
export async function inspectManifestDatasets(
  projectDir: string,
  manifest: Manifest,
): Promise<{ columns: Map<string, Column[]>; failures: Map<string, string> }> {
  const store = getContentStore(projectDir);
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    await store.configureEngine(conn);
    const { registered, failures } = await registerDatasets(projectDir, conn, store, manifest);
    const columns = new Map<string, Column[]>();
    for (const name of registered) {
      const reader = await conn.runAndReadAll(`SELECT * FROM ${quoteIdent(name)} LIMIT 0`);
      columns.set(name, columnsFromReader(reader));
    }
    return { columns, failures };
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

/**
 * Infers a loose data file's columns + types with no project manifest — a
 * transient in-memory DuckDB reads the file's schema via a zero-row query. The
 * "infer fast, formalize immediately" path: a file you haven't declared as a
 * dataset yet. SQLite needs a table, so it's rejected here with a pointer to
 * the project-dataset path.
 */
export async function inferFile(absPath: string): Promise<SourceSchema> {
  const ext = sourceExtension(absPath);
  if (ext === ".sqlite" || ext === ".db") {
    throw new Error(`sqlite file ${absPath} can't be inferred loosely — declare it as a project dataset with a 'table' instead`);
  }
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    const reader = await conn.runAndReadAll(`SELECT * FROM ${fileReaderExpr(absPath, absPath)} LIMIT 0`);
    return { dataset: basename(absPath, extname(absPath)), columns: columnsFromReader(reader) };
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

// --- Which fields does an island require from its dataset? -----------------------

function fieldOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Returns the dataset an island binds to and the fields it expects to exist. */
export function islandRequirements(island: Record<string, unknown>): { dataset: string | null; fields: string[] } {
  const type = island.type as string;
  const dataset = fieldOrNull(island.dataset);
  const fields = new Set<string>();
  const add = (v: unknown) => {
    const f = fieldOrNull(v);
    if (f) fields.add(f);
  };
  const addDetails = () => {
    const details = island.details;
    if (!Array.isArray(details)) return;
    for (const d of details) add((d as Record<string, unknown>).field);
  };
  const addGroupBy = () => {
    const groupBy = island.groupBy as Record<string, unknown> | undefined;
    if (!groupBy) return;
    add(groupBy.field);
    add(groupBy.titleField);
    add(groupBy.subtitleField);
  };
  const addDrilldownMatchFields = () => {
    const drilldown = island.drilldown as Record<string, unknown> | undefined;
    const match = drilldown?.match as Record<string, unknown> | undefined;
    if (!match) return;
    for (const clickedRowField of Object.values(match)) add(clickedRowField);
  };
  switch (type) {
    case "metric.kpi": {
      add(island.value);
      add(island.target);
      const c = island.compareTo;
      if (typeof c === "string" && c !== "prev" && c !== "none") add(c);
      break;
    }
    case "timeseries.line": {
      add(island.x);
      const y = island.y;
      if (Array.isArray(y)) y.forEach(add);
      else add(y);
      add(island.series);
      const opts = island.options as Record<string, unknown> | undefined;
      if (opts) add(opts.goalField);
      break;
    }
    case "category.bar":
      add(island.x);
      add(island.y);
      add(island.group);
      break;
    case "category.combo": {
      add(island.x);
      const bars = island.bars;
      if (Array.isArray(bars)) bars.forEach(add);
      else add(bars);
      const lines = island.lines;
      if (Array.isArray(lines)) lines.forEach(add);
      else add(lines);
      break;
    }
    case "waterfall.bars":
      add(island.label);
      add(island.value);
      add(island.kind);
      break;
    case "rank.list":
      add(island.label);
      add(island.value);
      add(island.secondary);
      break;
    case "breakdown.treemap":
      add(island.label);
      add(island.value);
      add(island.parent);
      break;
    case "table.grid": {
      const cols = island.columns;
      if (Array.isArray(cols)) {
        for (const col of cols) {
          const spec = col as Record<string, unknown>;
          add(spec.field);
          add((spec.status as Record<string, unknown> | undefined)?.signal);
        }
      }
      addDetails();
      addGroupBy();
      addDrilldownMatchFields();
      break;
    }
    case "timeline.feed": {
      add(island.ts);
      add(island.titleField);
      add(island.detail);
      add(island.kind);
      add((island.highlight as Record<string, unknown> | undefined)?.field);
      const stats = island.stats;
      if (Array.isArray(stats)) for (const stat of stats) add((stat as Record<string, unknown>).field);
      const footer = island.footer;
      if (Array.isArray(footer)) for (const item of footer) add((item as Record<string, unknown>).field);
      addDetails();
      addGroupBy();
      addDrilldownMatchFields();
      break;
    }
    case "gauge.rings": {
      const rings = island.rings;
      if (Array.isArray(rings)) {
        for (const ring of rings) {
          const spec = ring as Record<string, unknown>;
          add(spec.value);
          add(spec.max);
        }
      }
      break;
    }
    case "gauge.meter": {
      const meters = island.meters;
      if (Array.isArray(meters)) {
        for (const meter of meters) {
          const spec = meter as Record<string, unknown>;
          add(spec.value);
          add(spec.max);
        }
      }
      break;
    }
    case "status.grid":
      add(island.label);
      add(island.state);
      add(island.value);
      break;
    case "gauge.goal": {
      const goals = island.goals;
      if (Array.isArray(goals)) {
        for (const entry of goals) {
          const spec = entry as Record<string, unknown>;
          add(spec.value);
          const goal = spec.goal as Record<string, unknown> | undefined;
          if (goal) {
            add(goal.min);
            add(goal.max);
          }
        }
      }
      break;
    }
    case "search.box": {
      const searchFields = island.fields;
      if (Array.isArray(searchFields)) searchFields.forEach(add);
      add(island.titleField);
      add(island.detail);
      break;
    }
    case "category.pie":
      add(island.label);
      add(island.value);
      break;
    case "correlation.scatter":
      add(island.x);
      add(island.y);
      add(island.series);
      add(island.size);
      add(island.label);
      break;
    case "distribution.heatmap":
      add(island.x);
      add(island.y);
      add(island.value);
      break;
    case "activity.calendar":
      add(island.date);
      add(island.value);
      break;
    case "funnel.steps":
      add(island.label);
      add(island.value);
      break;
    case "compare.radar": {
      const metrics = island.metrics;
      if (Array.isArray(metrics)) metrics.forEach(add);
      add(island.series);
      break;
    }
    case "map.choropleth":
      add(island.region);
      add(island.value);
      break;
    case "metric.scorecard": {
      const stats = island.stats;
      if (Array.isArray(stats)) for (const stat of stats) add((stat as Record<string, unknown>).value);
      break;
    }
    // note.card, source.doc, content.editor, and custom islands bind to no dataset
  }
  return { dataset, fields: [...fields] };
}

// --- Contract check (islands + filters vs live dataset schemas) ------------------

/** Where a contract error came from: a custom island's own schema, a built-in island binding, or a page filter binding. */
export type ContractErrorKind = "custom" | "island" | "filter";

export interface ContractError extends IslandError {
  kind: ContractErrorKind;
}

export interface ContractCheckResult {
  checks: IslandCheck[];
  errors: ContractError[];
}

/**
 * Check every island and page filter of a validated manifest against live
 * dataset schemas. `columnsFor` resolves a dataset name to its column set
 * (null = unknown/unreadable). Shared by `compile` and the MCP server's
 * propose/validate path so the contract rules can never drift apart.
 */
export async function checkManifestContracts(
  projectDir: string,
  manifest: Manifest,
  columnsFor: (dataset: string) => Promise<Set<string> | null>,
): Promise<ContractCheckResult> {
  const checks: IslandCheck[] = [];
  const errors: ContractError[] = [];

  for (const page of manifest.pages) {
    for (const { island, index } of flattenPageIslands(page)) {
      const type = (island as { type: string }).type;
      const config = island as unknown as Record<string, unknown>;

      if (!BUILTIN_ISLAND_TYPES.includes(type as IslandType)) {
        try {
          for (const err of await checkCustomIsland(projectDir, type, config)) {
            errors.push({ kind: "custom", page: page.id, index, type, field: err.field, message: err.message });
          }
        } catch (e) {
          errors.push({ kind: "custom", page: page.id, index, type, message: `custom schema is broken: ${(e as Error).message}` });
        }
      }

      if (type === "form.entry") {
        const actionName = config.action as string;
        const action = manifest.actions?.[actionName];
        if (!action) {
          checks.push({ page: page.id, index, type, ok: false, missingFields: [] });
          errors.push({ kind: "island", page: page.id, index, type, field: "action", message: `unknown action '${actionName}' — declare it in manifest.actions` });
          continue;
        }
        const cols = await columnsFor(action.dataset);
        if (!cols) {
          checks.push({ page: page.id, index, type, dataset: action.dataset, ok: false, missingFields: [] });
          errors.push({ kind: "island", page: page.id, index, type, field: "action", message: `action '${actionName}' targets unknown or unreadable dataset '${action.dataset}'` });
          continue;
        }
        const listed = Array.isArray(config.fields) ? (config.fields as string[]) : [];
        const missing = listed.filter((f) => !cols.has(f));
        checks.push({ page: page.id, index, type, dataset: action.dataset, ok: missing.length === 0, missingFields: missing });
        for (const field of missing) {
          errors.push({ kind: "island", page: page.id, index, type, field, message: `form field '${field}' is not a column of action '${actionName}' dataset '${action.dataset}'. Available: ${[...cols].join(", ")}` });
        }
        continue;
      }

      const req = islandRequirements(config);
      if (!req.dataset) {
        checks.push({ page: page.id, index, type, ok: true, missingFields: [] });
        continue;
      }
      const cols = await columnsFor(req.dataset);
      if (!cols) {
        checks.push({ page: page.id, index, type, dataset: req.dataset, ok: false, missingFields: [] });
        errors.push({ kind: "island", page: page.id, index, type, field: "dataset", message: `bound to unknown or unreadable dataset '${req.dataset}'` });
        continue;
      }
      const missing = req.fields.filter((f) => !cols.has(f));
      checks.push({ page: page.id, index, type, dataset: req.dataset, ok: missing.length === 0, missingFields: missing });
      for (const field of missing) {
        errors.push({ kind: "island", page: page.id, index, type, field, message: `missing field '${field}' in dataset '${req.dataset}'. Available: ${[...cols].join(", ")}` });
      }

      const drilldown = config.drilldown as { island?: Record<string, unknown>; match?: Record<string, string> } | undefined;
      if (!drilldown?.island) continue;
      const prefix = `drilldown (${type})`;
      const ddReq = islandRequirements(drilldown.island);
      if (!ddReq.dataset) {
        errors.push({ kind: "island", page: page.id, index, type, field: "drilldown.island.dataset", message: `${prefix}: embedded island binds to no dataset` });
        continue;
      }
      const ddCols = await columnsFor(ddReq.dataset);
      if (!ddCols) {
        errors.push({ kind: "island", page: page.id, index, type, field: "drilldown.island.dataset", message: `${prefix}: bound to unknown or unreadable dataset '${ddReq.dataset}'` });
        continue;
      }
      for (const field of ddReq.fields.filter((f) => !ddCols.has(f))) {
        errors.push({ kind: "island", page: page.id, index, type, field, message: `${prefix}: missing field '${field}' in dataset '${ddReq.dataset}'. Available: ${[...ddCols].join(", ")}` });
      }
      for (const matchColumn of Object.keys(drilldown.match ?? {})) {
        if (!ddCols.has(matchColumn)) {
          errors.push({ kind: "island", page: page.id, index, type, field: matchColumn, message: `${prefix}: dataset '${ddReq.dataset}' has no column '${matchColumn}'. Available: ${[...ddCols].join(", ")}` });
        }
      }
    }

    for (const filter of page.filters ?? []) {
      for (const [dataset, column] of Object.entries(filter.bind)) {
        const cols = await columnsFor(dataset);
        if (!cols) {
          errors.push({ kind: "filter", page: page.id, index: -1, type: "filter", field: dataset, message: `filter '${filter.id}' binds to unknown or unreadable dataset '${dataset}'` });
          continue;
        }
        if (!cols.has(column)) {
          errors.push({ kind: "filter", page: page.id, index: -1, type: "filter", field: column, message: `filter '${filter.id}' binds dataset '${dataset}' on missing column '${column}'. Available: ${[...cols].join(", ")}` });
        }
      }
    }
  }

  return { checks, errors };
}

// --- Compile (contract check on live DuckDB schemas) ----------------------------

function formatContractError(e: ContractError): string {
  if (e.index < 0) return `[${e.page}] ${e.message}`;
  return `[${e.page}#${e.index} ${e.type}] ${e.message}`;
}

export async function compile(projectDir: string): Promise<CompileReport> {
  const report: CompileReport = {
    ok: false,
    snapshots: {},
    islandChecks: [],
    errors: [],
    warnings: [],
    manifestErrors: [],
  };

  const raw = await getContentStore(projectDir).readText(MANIFEST_REL);
  if (raw === null) {
    report.errors.push(`no manifest at ${manifestPathFor(projectDir)}`);
    return report;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    report.errors.push(`manifest is not valid JSON: ${(e as Error).message}`);
    return report;
  }

  const validation = validateManifest(parsed);
  if (!validation.ok || !validation.manifest) {
    report.manifestErrors = validation.errors;
    report.errors.push(...validation.errors.map((e) => `[${e.page}#${e.index} ${e.type}] ${e.message}`));
    return report;
  }
  const manifest = validation.manifest;
  report.manifest = manifest;

  resetEngine(projectDir);
  let engine: Engine;
  try {
    engine = await getEngine(projectDir);
  } catch (e) {
    report.errors.push((e as Error).message);
    return report;
  }

  const schemas: Record<string, Set<string>> = {};
  for (const name of engine.registered) {
    try {
      const result = await query(projectDir, name);
      schemas[name] = new Set(result.columns.map((c) => c.name));
      report.snapshots[name] = { dataset: name, columns: result.columns, rows: result.rows };
    } catch (e) {
      report.errors.push(`dataset '${name}': ${(e as Error).message}`);
    }
  }
  for (const [name, message] of engine.failures) {
    report.errors.push(`dataset '${name}': ${message}`);
  }

  const contracts = await checkManifestContracts(projectDir, manifest, async (dataset) => schemas[dataset] ?? null);
  report.islandChecks = contracts.checks;
  for (const error of contracts.errors) {
    const { kind, ...islandError } = error;
    if (kind === "custom") report.manifestErrors.push(islandError);
    report.errors.push(formatContractError(error));
  }

  if (manifest.connectors) {
    const connectorErrors = await checkConnectors(projectDir, manifest);
    for (const e of connectorErrors) report.errors.push(`[connector ${e.connector}] ${e.message}`);
  }

  if (manifest.queries) {
    const queryErrors = await checkQueries(projectDir, manifest);
    for (const e of queryErrors) report.errors.push(`[query ${e.query}] ${e.message}`);
  }

  for (const w of lintManifest(manifest)) {
    report.warnings.push(
      w.index < 0 ? `[${w.page}] ${w.message}` : `[${w.page}#${w.index} ${w.type}] ${w.message}`,
    );
  }

  report.ok = report.errors.length === 0;
  return report;
}
