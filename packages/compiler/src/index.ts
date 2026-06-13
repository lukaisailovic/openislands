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
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname, basename, isAbsolute } from "node:path";
import duckdb from "@duckdb/node-api";
import { BUILTIN_ISLAND_TYPES, flattenPageIslands, isSqliteSource, validateManifest, type Manifest, type DatasetSpec, type IslandError, type IslandType } from "@openislands/schema";
import { queryResultToArrowIPC } from "./arrow.js";
import { checkCustomIsland } from "./customSchema.js";
import { checkConnectors } from "./connectors.js";

export { queryResultToArrowIPC } from "./arrow.js";
export {
  checkCustomIsland,
  customIslandDir,
  customSchemaFile,
  resetCustomSchemaCache,
  type CustomIslandError,
} from "./customSchema.js";
export {
  actionRowSchema,
  insertRows,
  insertValidatedRows,
  replaceValidatedRows,
  datasetRowSchema,
  validateRows,
  ActionValidationError,
  MAX_SNAPSHOTS_PER_FILE,
  MAX_SNAPSHOT_BYTES_PER_FILE,
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

export interface CacheRef {
  dataset: string;
  path: string;
  hash: string;
}

const DEFAULT_ROW_CAP = 10_000;

// --- The per-project engine -----------------------------------------------------

interface Engine {
  conn: DuckDBConnection;
  manifest: Manifest;
  registered: Set<string>;
}

const engines = new Map<string, Promise<Engine>>();

function manifestPathFor(projectDir: string): string {
  return join(projectDir, "app", "manifest.json");
}

export function readManifest(projectDir: string): Manifest {
  const path = manifestPathFor(projectDir);
  if (!existsSync(path)) throw new Error(`no manifest at ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const validation = validateManifest(raw);
  if (!validation.ok || !validation.manifest) {
    const first = validation.errors[0];
    throw new Error(`invalid manifest: ${first ? first.message : "unknown error"}`);
  }
  return validation.manifest;
}

async function buildEngine(projectDir: string): Promise<Engine> {
  const manifest = readManifest(projectDir);
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await conn.run(`SET file_search_path=${quoteLiteral(projectDir)}`);
  const specs = Object.values(manifest.datasets);
  if (specs.some((spec) => spec.source && isSqliteSource(spec.source))) {
    await conn.run("INSTALL sqlite; LOAD sqlite;");
  }
  const registered = new Set<string>();
  for (const [name, spec] of Object.entries(manifest.datasets)) {
    await registerDataset(conn, projectDir, name, spec);
    registered.add(name);
  }
  return { conn, manifest, registered };
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

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function resolveSourcePath(projectDir: string, source: string): string {
  return isAbsolute(source) ? source : join(projectDir, source);
}

function sourceExtension(source: string): string {
  return extname(source.split("*")[0] ?? source).toLowerCase();
}

function fileReaderExpr(absPath: string): string {
  const lit = quoteLiteral(absPath);
  const ext = sourceExtension(absPath);
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
      throw new Error(`sqlite source ${absPath} can only be read through a dataset declaring its 'table'`);
    default:
      throw new Error(`unsupported source type '${ext}' for ${absPath}`);
  }
}

async function registerDataset(conn: DuckDBConnection, projectDir: string, name: string, spec: DatasetSpec): Promise<void> {
  const view = quoteIdent(name);
  if (spec.sql) {
    const sqlPath = resolveSourcePath(projectDir, spec.sql);
    if (!existsSync(sqlPath)) throw new Error(`dataset '${name}': sql transform not found: ${spec.sql}`);
    const body = readFileSync(sqlPath, "utf8").trim().replace(/;\s*$/, "");
    await conn.run(`CREATE VIEW ${view} AS ${body}`);
    return;
  }
  if (!spec.source) throw new Error(`dataset '${name}': no source`);
  const absPath = resolveSourcePath(projectDir, spec.source);
  const ext = sourceExtension(spec.source);
  if (ext === ".md" || ext === ".markdown") {
    await registerMarkdownDataset(conn, name, absPath);
    return;
  }
  if (isSqliteSource(spec.source)) {
    if (!spec.table) throw new Error(`dataset '${name}': a sqlite source needs a 'table'`);
    if (!existsSync(absPath)) throw new Error(`dataset '${name}': source not found: ${spec.source}`);
    await conn.run(`CREATE VIEW ${view} AS SELECT * FROM sqlite_scan(${quoteLiteral(absPath)}, ${quoteLiteral(spec.table)})`);
    return;
  }
  if (!absPath.includes("*") && !existsSync(absPath)) throw new Error(`dataset '${name}': source not found: ${spec.source}`);
  await conn.run(`CREATE VIEW ${view} AS SELECT * FROM ${fileReaderExpr(absPath)}`);
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

async function registerMarkdownDataset(conn: DuckDBConnection, name: string, absPath: string): Promise<void> {
  if (!existsSync(absPath)) throw new Error(`dataset '${name}': markdown source not found: ${absPath}`);
  const { data, body } = parseFrontMatter(readFileSync(absPath, "utf8"));
  const row: MarkdownRow = { file: basename(absPath), body, ...data };
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

export interface QueryOpts {
  limit?: number;
  range?: QueryRange;
  match?: QueryMatch[];
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
  if (!engine.registered.has(dataset)) throw new Error(`unknown dataset '${dataset}'`);
  const limit = opts?.limit ?? DEFAULT_ROW_CAP;
  const view = quoteIdent(dataset);

  const hasRange = !!opts?.range && (opts.range.from !== undefined || opts.range.to !== undefined);
  const hasMatch = !!opts?.match && opts.match.length > 0;
  if (!hasRange && !hasMatch) return runSelect(engine.conn, `SELECT * FROM ${view}`, limit);

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
  return runSelect(engine.conn, sql, opts?.limit ?? DEFAULT_ROW_CAP);
}

async function runSelect(conn: DuckDBConnection, sql: string, limit: number): Promise<QueryResult> {
  const capped = `SELECT * FROM (${sql}) AS _capped LIMIT ${Math.max(0, Math.floor(limit))}`;
  const reader = await conn.runAndReadAll(capped);
  return { columns: columnsFromReader(reader), rows: rowsFromReader(reader) };
}

/** Columns + types of a dataset (or raw file path) via a zero-row query. */
export async function inferSchema(projectDir: string, datasetOrFile: string): Promise<SourceSchema> {
  const engine = await getEngine(projectDir);
  if (engine.registered.has(datasetOrFile)) {
    const reader = await engine.conn.runAndReadAll(`SELECT * FROM ${quoteIdent(datasetOrFile)} LIMIT 0`);
    return { dataset: datasetOrFile, columns: columnsFromReader(reader) };
  }
  const absPath = resolveSourcePath(projectDir, datasetOrFile);
  const reader = await engine.conn.runAndReadAll(`SELECT * FROM ${fileReaderExpr(absPath)} LIMIT 0`);
  return { dataset: datasetOrFile, columns: columnsFromReader(reader) };
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
    const reader = await conn.runAndReadAll(`SELECT * FROM ${fileReaderExpr(absPath)} LIMIT 0`);
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
      add(island.value);
      const goal = island.goal as Record<string, unknown> | undefined;
      if (goal) {
        add(goal.min);
        add(goal.max);
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
    // note.card, source.doc, and custom islands bind to no dataset
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

  const manifestPath = manifestPathFor(projectDir);
  if (!existsSync(manifestPath)) {
    report.errors.push(`no manifest at ${manifestPath}`);
    return report;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    report.errors.push(`manifest is not valid JSON: ${(e as Error).message}`);
    return report;
  }

  const validation = validateManifest(raw);
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

  report.ok = report.errors.length === 0;
  return report;
}

// --- Optional Parquet cache (content-addressed, never the source of truth) ------

export async function materialize(projectDir: string, dataset: string): Promise<CacheRef> {
  const engine = await getEngine(projectDir);
  if (!engine.registered.has(dataset)) throw new Error(`unknown dataset '${dataset}'`);
  const spec = engine.manifest.datasets[dataset]!;
  const hash = createHash("sha256").update(JSON.stringify({ dataset, spec })).digest("hex").slice(0, 16);
  const dir = join(projectDir, "data", "cache");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${dataset}-${hash}.parquet`);
  await engine.conn.run(`COPY (SELECT * FROM ${quoteIdent(dataset)}) TO ${quoteLiteral(path)} (FORMAT parquet)`);
  return { dataset, path, hash };
}
