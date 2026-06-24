/**
 * Actions — manifest-declared, typed writes into a `source` dataset. `insert`
 * adds rows; the row schema is derived from the dataset's live DuckDB-inferred
 * columns and narrowed by the action's `fields` overrides, and that one schema
 * is the single source of truth for both row validation here and the JSON
 * Schema grounding the MCP server hands an agent. The physical write is
 * delegated to a storage-agnostic `DatasetWriter` (writers.ts), so a dataset
 * backed by a CSV/JSON file and one backed by a SQLite table take the exact
 * same path. Writes are guarded the same way as manifest edits: validate every
 * row, snapshot the target file to `.openislands/history/`, then write. No git
 * — rollback safety is the snapshot, full stop.
 */
import { z } from "zod";
import type { ActionSpec, FieldSpec, Manifest } from "@openislands/schema";
import { getAppStateStore, getContentStore } from "@openislands/storage";
import { inferSchema, invalidateEngineDatasets, readManifest, type Column, type ColumnType } from "./index.js";
import { resolveWriter, type WriteTarget } from "./writers.js";

export const MAX_SNAPSHOTS_PER_FILE = 20;
export const MAX_SNAPSHOT_BYTES_PER_FILE = 50 * 1024 * 1024;

export interface RetentionOpts {
  maxSnapshots?: number;
  maxSnapshotBytes?: number;
}

export interface RowError {
  row: number;
  field: string;
  message: string;
}

export class ActionValidationError extends Error {
  readonly errors: RowError[];
  constructor(errors: RowError[]) {
    super(`action validation failed: ${errors.length} error(s)`);
    this.name = "ActionValidationError";
    this.errors = errors;
  }
}

export interface InsertResult {
  inserted: number;
  checkpoint_id: string;
}

export interface ReplaceResult {
  replaced: number;
  checkpoint_id?: string;
}

function lookupAction(manifest: Manifest, actionName: string): ActionSpec {
  const action = manifest.actions?.[actionName];
  if (!action) throw new Error(`unknown action '${actionName}'`);
  return action;
}

/** Where an action's dataset physically writes: its source file, plus the table when that source is a SQLite database. Throws for a derived (`sql`) dataset, which has no row sink. */
function actionWriteTarget(manifest: Manifest, action: ActionSpec): WriteTarget {
  const spec = manifest.datasets[action.dataset];
  if (!spec) throw new Error(`action targets unknown dataset '${action.dataset}'`);
  if (!spec.source) throw new Error(`action dataset '${action.dataset}' has no source — derived datasets are not writable`);
  return { dataset: action.dataset, source: spec.source, table: spec.table };
}

function baseTypeSchema(type: ColumnType): z.ZodType {
  if (type === "number") return z.number();
  if (type === "boolean") return z.boolean();
  if (type === "date") {
    return z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "must be a valid date string" });
  }
  return z.string();
}

function columnSchema(type: ColumnType, spec: FieldSpec | undefined): z.ZodType {
  if (!spec) return baseTypeSchema(type);

  let schema = spec.enum
    ? z.enum(spec.enum as [string, ...string[]])
    : withBounds(baseTypeSchema(spec.type ?? type), spec);
  if (spec.description) schema = schema.describe(spec.description);
  if (spec.default !== undefined) schema = schema.default(spec.default);
  return schema;
}

function withBounds(schema: z.ZodType, spec: FieldSpec): z.ZodType {
  if (!(schema instanceof z.ZodNumber)) return schema;
  let num = schema;
  if (spec.min !== undefined) num = num.min(spec.min);
  if (spec.max !== undefined) num = num.max(spec.max);
  return num;
}

/**
 * Resolves an action's target columns from the live dataset and validates that
 * every `fields` override names a real column — the same compatible-refinement
 * discipline as island binding checks. The shared prelude for both the row
 * schema (validation) and the form descriptors (rendering), so they can't drift.
 */
async function resolveActionColumns(projectDir: string, actionName: string): Promise<{ action: ActionSpec; columns: Column[] }> {
  const manifest = await readManifest(projectDir);
  const action = lookupAction(manifest, actionName);
  const schema = await inferSchema(projectDir, action.dataset);
  const columnNames = new Set(schema.columns.map((c) => c.name));
  for (const fieldName of Object.keys(action.fields ?? {})) {
    if (!columnNames.has(fieldName)) {
      throw new Error(`action '${actionName}': field '${fieldName}' is not a column of dataset '${action.dataset}'`);
    }
  }
  return { action, columns: schema.columns };
}

/**
 * Derives the strict Zod row schema for an action: dataset column types merged
 * with the action's `fields` overrides — the single source of truth for row
 * validation here and the JSON Schema the MCP server hands an agent.
 */
export async function actionRowSchema(projectDir: string, actionName: string): Promise<z.ZodObject> {
  const { action, columns } = await resolveActionColumns(projectDir, actionName);
  const shape: Record<string, z.ZodType> = {};
  for (const column of columns) {
    shape[column.name] = columnSchema(column.type, action.fields?.[column.name]);
  }
  return z.object(shape).strict();
}

/**
 * One field of an action, shaped for a form UI: a dataset column's inferred type
 * merged with its `fields` override. The render-side mirror of the row schema
 * `actionRowSchema` validates against — a column is `required` unless its
 * override supplies a `default`.
 */
export interface ActionField {
  name: string;
  type: "string" | "number" | "boolean" | "date";
  required: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  default?: string | number | boolean;
  description?: string;
}

/** An action's fields as render-ready descriptors — the same column+override merge as `actionRowSchema`, projected for building a form rather than validating a row. */
export async function actionFields(projectDir: string, actionName: string): Promise<ActionField[]> {
  const { action, columns } = await resolveActionColumns(projectDir, actionName);
  return columns.map((column) => {
    const spec = action.fields?.[column.name];
    return {
      name: column.name,
      type: spec?.type ?? column.type,
      required: spec?.default === undefined,
      enum: spec?.enum,
      min: spec?.min,
      max: spec?.max,
      default: spec?.default,
      description: spec?.description,
    };
  });
}

/**
 * The strict Zod row schema for a dataset straight from its live column types,
 * no `fields` overrides. Used by the connector write path, where row shaping
 * lives in the connector code, not the manifest. A dataset whose source file
 * doesn't exist yet has no inferable columns — the connector's first sync then
 * writes whatever keys its rows carry, so an empty schema accepting any object
 * is returned.
 */
export async function datasetRowSchema(projectDir: string, dataset: string): Promise<z.ZodObject> {
  const manifest = await readManifest(projectDir);
  const spec = manifest.datasets[dataset];
  const source = spec?.source;
  if (source && !(await getContentStore(projectDir).exists(source))) {
    return z.object({}).catchall(z.unknown());
  }
  const schema = await inferSchema(projectDir, dataset);
  const shape: Record<string, z.ZodType> = {};
  for (const column of schema.columns) shape[column.name] = baseTypeSchema(column.type);
  return z.object(shape).strict();
}

export interface ValidatedRows {
  rows: Record<string, unknown>[];
  errors: RowError[];
}

export function validateRows(schema: z.ZodObject, rows: unknown[]): ValidatedRows {
  const out: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  rows.forEach((row, index) => {
    const result = schema.safeParse(row);
    if (result.success) {
      out.push(result.data as Record<string, unknown>);
      return;
    }
    for (const issue of result.error.issues) {
      errors.push({ row: index, field: issue.path.join(".") || "(row)", message: issue.message });
    }
  });
  return { rows: out, errors };
}

const HISTORY_PREFIX = "history";

/**
 * Snapshot a dataset source's current bytes into the app state store before a
 * mutation. The id encodes the restore target (`ckpt-<ts>!<encoded source>`) and
 * is made unique by bumping the timestamp past any collision.
 */
async function snapshotFile(projectDir: string, source: string): Promise<string> {
  const bytes = await getContentStore(projectDir).readBytes(source);
  if (bytes === null) throw new Error(`cannot snapshot missing source: ${source}`);
  const state = getAppStateStore(projectDir);
  const encoded = encodeURIComponent(source);
  let ts = Date.now();
  while (await state.exists(`${HISTORY_PREFIX}/ckpt-${ts}!${encoded}`)) ts += 1;
  const id = `ckpt-${ts}!${encoded}`;
  await state.put(`${HISTORY_PREFIX}/${id}`, bytes);
  return id;
}

async function pruneSnapshots(projectDir: string, source: string, opts: RetentionOpts): Promise<void> {
  const state = getAppStateStore(projectDir);
  const maxCount = opts.maxSnapshots ?? MAX_SNAPSHOTS_PER_FILE;
  const maxBytes = opts.maxSnapshotBytes ?? MAX_SNAPSHOT_BYTES_PER_FILE;
  const target = encodeURIComponent(source);

  const snapshots = (await state.list(HISTORY_PREFIX))
    .filter((e) => e.name.includes("!") && e.name.slice(e.name.indexOf("!") + 1) === target)
    .map((e) => ({ key: e.key, size: e.size, ts: parseTimestamp(e.name) }))
    .toSorted((a, b) => a.ts - b.ts);

  let count = snapshots.length;
  let totalBytes = snapshots.reduce((sum, s) => sum + s.size, 0);
  for (const snapshot of snapshots) {
    if (count <= maxCount && totalBytes <= maxBytes) break;
    await state.delete(snapshot.key);
    count -= 1;
    totalBytes -= snapshot.size;
  }
}

function parseTimestamp(checkpointId: string): number {
  const match = /^ckpt-(\d+)!/.exec(checkpointId);
  return match ? Number(match[1]) : 0;
}

export async function snapshotIfExists(projectDir: string, source: string): Promise<string | undefined> {
  if (!(await getContentStore(projectDir).exists(source))) return undefined;
  return snapshotFile(projectDir, source);
}

export { snapshotFile, pruneSnapshots };

/**
 * Validate rows against a row schema, snapshot the target, then insert them via
 * the dataset's writer — creating a flat file that doesn't exist yet. The shared
 * core under both the action insert path and the connector insert path.
 * All-or-nothing: any invalid row throws an `ActionValidationError` and nothing
 * is written. Re-registers the written dataset afterwards so the next query
 * re-reads the data (and its FTS sidecar, if any, is rebuilt).
 */
export async function insertValidatedRows(
  projectDir: string,
  target: WriteTarget,
  schema: z.ZodObject,
  rows: unknown[],
  opts: RetentionOpts = {},
): Promise<InsertResult> {
  const { rows: validated, errors } = validateRows(schema, rows);
  if (errors.length > 0) throw new ActionValidationError(errors);

  const writer = resolveWriter(getContentStore(projectDir), target);
  const checkpoint_id = (await writer.exists()) ? await snapshotFile(projectDir, writer.path) : "";
  await writer.insert(validated);
  if (checkpoint_id) await pruneSnapshots(projectDir, writer.path, opts);
  await invalidateEngineDatasets(projectDir, [target.dataset]);
  return { inserted: rows.length, checkpoint_id };
}

/**
 * Validate rows against a row schema, snapshot the existing target (if any),
 * then overwrite every row through the dataset's writer. A fresh flat file is
 * created with no snapshot (checkpoint_id undefined). Re-registers the written
 * dataset so the next query re-reads (rebuilding its FTS sidecar, if any).
 */
export async function replaceValidatedRows(
  projectDir: string,
  target: WriteTarget,
  schema: z.ZodObject,
  rows: unknown[],
  opts: RetentionOpts = {},
): Promise<ReplaceResult> {
  const { rows: validated, errors } = validateRows(schema, rows);
  if (errors.length > 0) throw new ActionValidationError(errors);

  const writer = resolveWriter(getContentStore(projectDir), target);
  const checkpoint_id = await snapshotIfExists(projectDir, writer.path);
  await writer.replace(validated);
  if (checkpoint_id) await pruneSnapshots(projectDir, writer.path, opts);
  await invalidateEngineDatasets(projectDir, [target.dataset]);
  return { replaced: rows.length, checkpoint_id };
}

/**
 * Validates every row against the action's row schema, snapshots the target,
 * then inserts. All-or-nothing: any invalid row throws an `ActionValidationError`
 * (naming row index + field) and nothing is written.
 */
export async function insertRows(
  projectDir: string,
  actionName: string,
  rows: unknown[],
  opts: RetentionOpts = {},
): Promise<InsertResult> {
  const manifest = await readManifest(projectDir);
  const action = lookupAction(manifest, actionName);
  const target = actionWriteTarget(manifest, action);
  const schema = await actionRowSchema(projectDir, actionName);
  return insertValidatedRows(projectDir, target, schema, rows, opts);
}
