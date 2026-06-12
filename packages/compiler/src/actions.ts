/**
 * Actions — manifest-declared, typed, append-only writes into a `source`
 * dataset. The row schema is derived from the dataset's live DuckDB-inferred
 * columns and narrowed by the action's `fields` overrides; that one schema is
 * the single source of truth for both row validation here and the JSON Schema
 * grounding the MCP server hands an agent. Writes are guarded the same way as
 * manifest edits: validate every row, snapshot the target file to
 * `.openislands/history/`, then append. No git — rollback safety is the
 * snapshot, full stop.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ActionSpec, FieldSpec, Manifest } from "@openislands/schema";
import { inferSchema, readManifest, resolveSourcePath, type ColumnType } from "./index.js";

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

export interface AppendResult {
  appended: number;
  checkpoint_id: string;
}

function lookupAction(manifest: Manifest, actionName: string): ActionSpec {
  const action = manifest.actions?.[actionName];
  if (!action) throw new Error(`unknown action '${actionName}'`);
  return action;
}

function actionSourcePath(projectDir: string, manifest: Manifest, action: ActionSpec): string {
  const spec = manifest.datasets[action.dataset];
  if (!spec) throw new Error(`action targets unknown dataset '${action.dataset}'`);
  if (!spec.source) throw new Error(`action dataset '${action.dataset}' has no source — derived datasets are not writable`);
  return resolveSourcePath(projectDir, spec.source);
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

export { snapshotFile, pruneSnapshots, extensionOf };

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

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

const WRITABLE_EXTENSIONS = [".csv", ".json", ".ndjson", ".jsonl"];

function assertWritable(ext: string): void {
  if (!WRITABLE_EXTENSIONS.includes(ext)) {
    throw new Error(`cannot write '${ext}' files — writable: ${WRITABLE_EXTENSIONS.join(", ")}`);
  }
}

/**
 * Writes validated rows to a fresh source file in the format its extension
 * implies — CSV header from the first row's keys, .json as an array, .ndjson/
 * .jsonl as lines. The first sync of a connector hits this when the target
 * dataset file doesn't exist yet.
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

export interface ReplaceResult {
  replaced: number;
  checkpoint_id?: string;
}

/**
 * Validate rows against a row schema, snapshot the target, then append —
 * creating the file if it doesn't exist yet. The shared core under both the
 * action append path and the connector append path. All-or-nothing: any invalid
 * row throws an `ActionValidationError` and nothing is written.
 */
export async function appendValidatedRows(
  projectDir: string,
  sourcePath: string,
  schema: z.ZodObject,
  rows: unknown[],
  opts: RetentionOpts = {},
): Promise<AppendResult> {
  const ext = extensionOf(sourcePath);
  assertWritable(ext);

  const { rows: validated, errors } = validateRows(schema, rows);
  if (errors.length > 0) throw new ActionValidationError(errors);

  if (!existsSync(sourcePath)) {
    writeNewFile(sourcePath, ext, validated);
    return { appended: rows.length, checkpoint_id: "" };
  }

  const checkpoint_id = snapshotFile(projectDir, sourcePath);
  appendToFile(sourcePath, ext, validated);
  pruneSnapshots(projectDir, sourcePath, opts);
  return { appended: rows.length, checkpoint_id };
}

/**
 * Validate rows against a row schema, snapshot the existing file (if any), then
 * overwrite the whole file in the dataset's format. A fresh file is created and
 * no snapshot is taken (checkpoint_id undefined).
 */
export async function replaceValidatedRows(
  projectDir: string,
  sourcePath: string,
  schema: z.ZodObject,
  rows: unknown[],
  opts: RetentionOpts = {},
): Promise<ReplaceResult> {
  const ext = extensionOf(sourcePath);
  assertWritable(ext);

  const { rows: validated, errors } = validateRows(schema, rows);
  if (errors.length > 0) throw new ActionValidationError(errors);

  const checkpoint_id = snapshotIfExists(projectDir, sourcePath);
  writeNewFile(sourcePath, ext, validated);
  if (checkpoint_id) pruneSnapshots(projectDir, sourcePath, opts);
  return { replaced: rows.length, checkpoint_id };
}

/**
 * Validates every row against the action's row schema, snapshots the target
 * file, then appends. All-or-nothing: any invalid row throws an
 * `ActionValidationError` (naming row index + field) and nothing is written.
 */
export async function appendRows(
  projectDir: string,
  actionName: string,
  rows: unknown[],
  opts: RetentionOpts = {},
): Promise<AppendResult> {
  const manifest = readManifest(projectDir);
  const action = lookupAction(manifest, actionName);
  const sourcePath = actionSourcePath(projectDir, manifest, action);
  const schema = await actionRowSchema(projectDir, actionName);
  return appendValidatedRows(projectDir, sourcePath, schema, rows, opts);
}
