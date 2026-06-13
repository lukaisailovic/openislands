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
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ActionSpec, FieldSpec, Manifest } from "@openislands/schema";
import { inferSchema, readManifest, resolveSourcePath, resetEngine, type ColumnType } from "./index.js";
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
function actionWriteTarget(projectDir: string, manifest: Manifest, action: ActionSpec): WriteTarget {
  const spec = manifest.datasets[action.dataset];
  if (!spec) throw new Error(`action targets unknown dataset '${action.dataset}'`);
  if (!spec.source) throw new Error(`action dataset '${action.dataset}' has no source — derived datasets are not writable`);
  return { sourcePath: resolveSourcePath(projectDir, spec.source), table: spec.table };
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
 * Derives the strict Zod row schema for an action: dataset column types merged
 * with the action's `fields` overrides. A `fields` key naming a column that
 * isn't in the dataset throws — the same compatible-refinement discipline as
 * island binding checks.
 */
export async function actionRowSchema(projectDir: string, actionName: string): Promise<z.ZodObject> {
  const manifest = readManifest(projectDir);
  const action = lookupAction(manifest, actionName);
  const schema = await inferSchema(projectDir, action.dataset);
  const columnNames = new Set(schema.columns.map((c) => c.name));

  for (const fieldName of Object.keys(action.fields ?? {})) {
    if (!columnNames.has(fieldName)) {
      throw new Error(`action '${actionName}': field '${fieldName}' is not a column of dataset '${action.dataset}'`);
    }
  }

  const shape: Record<string, z.ZodType> = {};
  for (const column of schema.columns) {
    shape[column.name] = columnSchema(column.type, action.fields?.[column.name]);
  }
  return z.object(shape).strict();
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
  const manifest = readManifest(projectDir);
  const spec = manifest.datasets[dataset];
  const source = spec?.source;
  if (source && !existsSync(resolveSourcePath(projectDir, source))) {
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

function historyDir(projectDir: string): string {
  return join(projectDir, ".openislands", "history");
}

function snapshotFile(projectDir: string, sourcePath: string): string {
  const encoded = encodeURIComponent(relativeSource(projectDir, sourcePath));
  const dir = historyDir(projectDir);
  mkdirSync(dir, { recursive: true });
  let ts = Date.now();
  while (existsSync(join(dir, `ckpt-${ts}!${encoded}`))) ts += 1;
  const id = `ckpt-${ts}!${encoded}`;
  writeFileSync(join(dir, id), readFileSync(sourcePath));
  return id;
}

function relativeSource(projectDir: string, sourcePath: string): string {
  const prefix = projectDir.endsWith("/") ? projectDir : `${projectDir}/`;
  return sourcePath.startsWith(prefix) ? sourcePath.slice(prefix.length) : sourcePath;
}

function pruneSnapshots(projectDir: string, sourcePath: string, opts: RetentionOpts): void {
  const dir = historyDir(projectDir);
  if (!existsSync(dir)) return;
  const maxCount = opts.maxSnapshots ?? MAX_SNAPSHOTS_PER_FILE;
  const maxBytes = opts.maxSnapshotBytes ?? MAX_SNAPSHOT_BYTES_PER_FILE;
  const target = encodeURIComponent(relativeSource(projectDir, sourcePath));

  const snapshots = readdirSync(dir)
    .filter((name) => name.includes("!") && name.slice(name.indexOf("!") + 1) === target)
    .map((name) => ({ name, path: join(dir, name), size: statSync(join(dir, name)).size, ts: parseTimestamp(name) }))
    .toSorted((a, b) => a.ts - b.ts);

  let count = snapshots.length;
  let totalBytes = snapshots.reduce((sum, s) => sum + s.size, 0);
  for (const snapshot of snapshots) {
    if (count <= maxCount && totalBytes <= maxBytes) break;
    unlinkSync(snapshot.path);
    count -= 1;
    totalBytes -= snapshot.size;
  }
}

function parseTimestamp(checkpointId: string): number {
  const match = /^ckpt-(\d+)!/.exec(checkpointId);
  return match ? Number(match[1]) : 0;
}

export function snapshotIfExists(projectDir: string, sourcePath: string): string | undefined {
  if (!existsSync(sourcePath)) return undefined;
  return snapshotFile(projectDir, sourcePath);
}

export { snapshotFile, pruneSnapshots };

/**
 * Validate rows against a row schema, snapshot the target, then insert them via
 * the dataset's writer — creating a flat file that doesn't exist yet. The shared
 * core under both the action insert path and the connector insert path.
 * All-or-nothing: any invalid row throws an `ActionValidationError` and nothing
 * is written. Resets the engine afterwards so the next query re-reads the data.
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

  const writer = resolveWriter(target);
  const checkpoint_id = writer.exists() ? snapshotFile(projectDir, writer.path) : "";
  await writer.insert(validated);
  if (checkpoint_id) pruneSnapshots(projectDir, writer.path, opts);
  resetEngine(projectDir);
  return { inserted: rows.length, checkpoint_id };
}

/**
 * Validate rows against a row schema, snapshot the existing target (if any),
 * then overwrite every row through the dataset's writer. A fresh flat file is
 * created with no snapshot (checkpoint_id undefined). Resets the engine so the
 * next query re-reads.
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

  const writer = resolveWriter(target);
  const checkpoint_id = snapshotIfExists(projectDir, writer.path);
  await writer.replace(validated);
  if (checkpoint_id) pruneSnapshots(projectDir, writer.path, opts);
  resetEngine(projectDir);
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
  const manifest = readManifest(projectDir);
  const action = lookupAction(manifest, actionName);
  const target = actionWriteTarget(projectDir, manifest, action);
  const schema = await actionRowSchema(projectDir, actionName);
  return insertValidatedRows(projectDir, target, schema, rows, opts);
}
