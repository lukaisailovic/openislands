/**
 * Queries — manifest-declared, typed, read-only reads. The read mirror of
 * actions: an action declares a typed write into a dataset; a query declares a
 * typed read out of one. A query is *declarative* (not raw SQL): a dataset, typed
 * `params`, and optional `select` / `where` / `groupBy` / `orderBy` / `limit`,
 * which this module translates into one parameterized DuckDB SELECT. Every value
 * (a param or a literal) is bound as a prepared-statement parameter and every
 * identifier is verified against the live columns before it is quoted, so an
 * agent-authored query can never inject SQL. The translation is the single source
 * of truth for both `run_query` and the validation the MCP server / `validate`
 * surface. Heavy shaping (joins, CTEs) lives in a `sql` transform the query reads
 * from — there are no joins here by design.
 */
import { z } from "zod";
import type { Manifest, QueryColumn, QueryFilter, QueryParam, QuerySpec } from "@openislands/schema";
import { inferSchema, queryWithParams, quoteIdent, readManifest, type Column, type ColumnType, type Row } from "./index.js";

export interface ParamError {
  param: string;
  message: string;
}

export class QueryValidationError extends Error {
  readonly errors: ParamError[];
  constructor(errors: ParamError[]) {
    super(`query params invalid: ${errors.length} error(s)`);
    this.name = "QueryValidationError";
    this.errors = errors;
  }
}

export interface QueryRunResult {
  columns: Column[];
  rows: Row[];
}

/** A validate-time problem with a declared query (mirrors ConnectorValidationError). */
export interface QueryContractError {
  query: string;
  field?: string;
  message: string;
}

function lookupQuery(manifest: Manifest, name: string): QuerySpec {
  const q = manifest.queries?.[name];
  if (!q) throw new Error(`unknown query '${name}'`);
  return q;
}

// --- Parameter schema (shared by validation + the MCP grounding) -----------------

function baseParamSchema(type: "string" | "number" | "boolean" | "date"): z.ZodType {
  if (type === "number") return z.number();
  if (type === "boolean") return z.boolean();
  if (type === "date") return z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "must be a valid date string" });
  return z.string();
}

/** A single param's Zod schema: type/enum/min/max + required/optional/default. Required by default; optional iff required:false or a default is set. */
function paramZodSchema(param: QueryParam): z.ZodType {
  const type = param.type ?? "string";
  let schema: z.ZodType = param.enum ? z.enum(param.enum as [string, ...string[]]) : baseParamSchema(type);
  if (!param.enum && type === "number") {
    let num = schema as z.ZodNumber;
    if (param.min !== undefined) num = num.min(param.min);
    if (param.max !== undefined) num = num.max(param.max);
    schema = num;
  }
  if (param.description) schema = schema.describe(param.description);
  if (param.default !== undefined) return schema.default(param.default);
  if (param.required === false) return schema.optional();
  return schema;
}

/** The strict Zod object validating a query's params object. Unknown params rejected. */
export async function queryParamSchema(projectDir: string, name: string): Promise<z.ZodObject> {
  const manifest = await readManifest(projectDir);
  const spec = lookupQuery(manifest, name);
  const shape: Record<string, z.ZodType> = {};
  for (const [pname, param] of Object.entries(spec.params ?? {})) shape[pname] = paramZodSchema(param);
  return z.object(shape).strict();
}

export function validateParams(schema: z.ZodObject, params: unknown): { values: Record<string, unknown>; errors: ParamError[] } {
  const result = schema.safeParse(params ?? {});
  if (result.success) return { values: result.data as Record<string, unknown>, errors: [] };
  const errors = result.error.issues.map((issue) => ({ param: issue.path.join(".") || "(params)", message: issue.message }));
  return { values: {}, errors };
}

// --- Declarative spec → parameterized SQL ----------------------------------------

const COMPARE_SQL: Record<string, string> = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" };

function normalizeColumn(item: string | QueryColumn): QueryColumn {
  return typeof item === "string" ? { field: item } : item;
}

/** The output name of a projected column: its alias, else `fn_field` for an aggregate, else the field. */
function columnAlias(item: QueryColumn): string {
  if (item.as) return item.as;
  if (item.fn) return `${item.fn}_${item.field === "*" ? "all" : item.field}`;
  return item.field;
}

function selectClause(spec: QuerySpec): string {
  if (!spec.select || spec.select.length === 0) return "*";
  return spec.select
    .map((raw) => {
      const item = normalizeColumn(raw);
      const inner = item.field === "*" ? "*" : quoteIdent(item.field);
      const expr = item.fn ? `${item.fn}(${inner})` : inner;
      const needsAlias = item.as !== undefined || item.fn !== undefined;
      return needsAlias ? `${expr} AS ${quoteIdent(columnAlias(item))}` : expr;
    })
    .join(", ");
}

/**
 * Build one filter's SQL clause, binding its value. Returns null when the filter
 * names a `param` that wasn't supplied — an omitted optional param drops its
 * filter. `bind` accumulates the named values; `counter` makes literal binds unique.
 */
function filterClause(
  filter: QueryFilter,
  colType: Map<string, ColumnType>,
  values: Record<string, unknown>,
  bind: Record<string, unknown>,
  counter: { n: number },
): string | null {
  const op = filter.op ?? "eq";
  const id = quoteIdent(filter.field);

  const literalBind = (v: unknown): string => {
    const key = `_v${counter.n++}`;
    bind[key] = v;
    return key;
  };

  if (op === "in") {
    const raw = filter.param !== undefined ? values[filter.param] : filter.value;
    if (filter.param !== undefined && !(filter.param in values)) return null;
    const arr = Array.isArray(raw) ? raw : [raw];
    if (arr.length === 0) return null;
    const placeholders = arr.map((v) => `$${literalBind(v)}`);
    return `${id} IN (${placeholders.join(", ")})`;
  }

  let bindKey: string;
  if (filter.param !== undefined) {
    if (!(filter.param in values)) return null;
    bindKey = filter.param;
    bind[filter.param] = values[filter.param];
  } else {
    bindKey = literalBind(filter.value);
  }
  const placeholder = `$${bindKey}`;

  if (op === "contains") return `CAST(${id} AS VARCHAR) ILIKE '%' || ${placeholder} || '%'`;
  if (op === "sameDay") return `CAST(${id} AS DATE) = TRY_CAST(${placeholder} AS DATE)`;

  const sqlOp = COMPARE_SQL[op] ?? "=";
  const rhs = colType.get(filter.field) === "date" ? `TRY_CAST(${placeholder} AS DATE)` : placeholder;
  return `${id} ${sqlOp} ${rhs}`;
}

export interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
}

/**
 * Translate a query spec into a parameterized DuckDB SELECT given the dataset's
 * live columns and the supplied param values. Pure string assembly: identifiers
 * are quoted (and were verified by the caller), every value is bound.
 */
export function buildQuerySql(spec: QuerySpec, columns: Column[], values: Record<string, unknown>): BuiltQuery {
  const colType = new Map(columns.map((c) => [c.name, c.type] as const));
  const bind: Record<string, unknown> = {};
  const counter = { n: 0 };

  const conds: string[] = [];
  for (const filter of spec.where ?? []) {
    const clause = filterClause(filter, colType, values, bind, counter);
    if (clause) conds.push(clause);
  }

  let sql = `SELECT ${selectClause(spec)} FROM ${quoteIdent(spec.dataset)}`;
  if (conds.length > 0) sql += ` WHERE ${conds.join(" AND ")}`;
  if (spec.groupBy && spec.groupBy.length > 0) sql += ` GROUP BY ${spec.groupBy.map(quoteIdent).join(", ")}`;
  if (spec.orderBy && spec.orderBy.length > 0) {
    sql += ` ORDER BY ${spec.orderBy.map((o) => `${quoteIdent(o.field)} ${(o.dir ?? "asc").toUpperCase()}`).join(", ")}`;
  }
  if (spec.limit !== undefined) sql += ` LIMIT ${Math.max(0, Math.floor(spec.limit))}`;
  return { sql, params: bind };
}

// --- Field verification (fail loud, name the field — like an island binding) ------

function selectAliases(spec: QuerySpec): Set<string> {
  const aliases = new Set<string>();
  for (const raw of spec.select ?? []) {
    const item = normalizeColumn(raw);
    if (item.as) aliases.add(item.as);
  }
  return aliases;
}

/** Collect every field a spec references that must exist as a base column, paired with where it appears. `orderBy` may also name a select alias, so it's checked separately. */
function fieldRefs(spec: QuerySpec): { field: string; where: string }[] {
  const refs: { field: string; where: string }[] = [];
  for (const raw of spec.select ?? []) {
    const item = normalizeColumn(raw);
    if (item.field !== "*") refs.push({ field: item.field, where: "select" });
  }
  for (const filter of spec.where ?? []) refs.push({ field: filter.field, where: "where" });
  for (const field of spec.groupBy ?? []) refs.push({ field, where: "groupBy" });
  return refs;
}

/** Every referenced field that isn't a real column — the shared basis for the run-time and validate-time checks. `orderBy` may also name a select alias, so it's allowed there. */
function missingFields(spec: QuerySpec, columns: Column[]): { field: string; where: string }[] {
  const colNames = new Set(columns.map((c) => c.name));
  const aliases = selectAliases(spec);
  const missing = fieldRefs(spec).filter((ref) => !colNames.has(ref.field));
  for (const order of spec.orderBy ?? []) {
    if (!colNames.has(order.field) && !aliases.has(order.field)) missing.push({ field: order.field, where: "orderBy" });
  }
  return missing;
}

// --- Run + validate --------------------------------------------------------------

async function datasetColumns(projectDir: string, dataset: string): Promise<Column[]> {
  return (await inferSchema(projectDir, dataset)).columns;
}

/**
 * Validate params, translate the spec to SQL, and run it read-only and row-capped.
 * All-or-nothing on params: a bad/missing param throws QueryValidationError and
 * nothing runs. Fields are verified against the live columns before the SQL is built.
 */
export async function runQuery(projectDir: string, name: string, params?: unknown, opts?: { limit?: number }): Promise<QueryRunResult> {
  const manifest = await readManifest(projectDir);
  const spec = lookupQuery(manifest, name);
  if (!manifest.datasets[spec.dataset]) throw new Error(`query '${name}': unknown dataset '${spec.dataset}'`);

  const schema = await queryParamSchema(projectDir, name);
  const { values, errors } = validateParams(schema, params);
  if (errors.length > 0) throw new QueryValidationError(errors);

  const columns = await datasetColumns(projectDir, spec.dataset);
  const [missing] = missingFields(spec, columns);
  if (missing) throw new Error(`query '${name}': field '${missing.field}' (${missing.where}) not in dataset '${spec.dataset}'`);

  const built = buildQuerySql(spec, columns, values);
  const result = await queryWithParams(projectDir, built.sql, built.params, { limit: opts?.limit });
  return { columns: result.columns, rows: result.rows };
}

/** The result columns a query produces — for `list_queries` grounding. Plain columns keep their live type; aggregates report number (count/sum/avg) or the field's type (min/max). */
export async function queryColumns(projectDir: string, name: string): Promise<Column[]> {
  const manifest = await readManifest(projectDir);
  const spec = lookupQuery(manifest, name);
  const base = await datasetColumns(projectDir, spec.dataset);
  if (!spec.select || spec.select.length === 0) return base;
  const baseType = new Map(base.map((c) => [c.name, c.type] as const));
  return spec.select.map((raw) => {
    const item = normalizeColumn(raw);
    let type: ColumnType = baseType.get(item.field) ?? "string";
    if (item.fn === "count" || item.fn === "sum" || item.fn === "avg") type = "number";
    return { name: columnAlias(item), type };
  });
}

/**
 * Validate every declared query at compile time against the live datasets: the
 * dataset must exist and be readable, and every `field` a query references must be
 * a real column (orderBy may also name a select alias). Mirrors checkConnectors —
 * collects all problems rather than throwing on the first.
 */
export async function checkQueries(
  projectDir: string,
  manifest: Manifest,
  columnsFor?: (dataset: string) => Promise<Column[] | null>,
): Promise<QueryContractError[]> {
  const errors: QueryContractError[] = [];
  for (const [name, spec] of Object.entries(manifest.queries ?? {})) {
    if (!manifest.datasets[spec.dataset]) {
      errors.push({ query: name, field: "dataset", message: `unknown dataset '${spec.dataset}'` });
      continue;
    }
    let columns: Column[] | null;
    if (columnsFor) {
      columns = await columnsFor(spec.dataset);
      if (!columns) {
        errors.push({ query: name, field: "dataset", message: `cannot read dataset '${spec.dataset}'` });
        continue;
      }
    } else {
      try {
        columns = await datasetColumns(projectDir, spec.dataset);
      } catch (e) {
        errors.push({ query: name, field: "dataset", message: `cannot read dataset '${spec.dataset}': ${(e as Error).message}` });
        continue;
      }
    }
    const available = `Available: ${columns.map((c) => c.name).join(", ")}`;
    for (const miss of missingFields(spec, columns)) {
      errors.push({ query: name, field: miss.where, message: `field '${miss.field}' (${miss.where}) not in dataset '${spec.dataset}'. ${available}` });
    }
  }
  return errors;
}
