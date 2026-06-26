/**
 * @openislands/mcp — the per-app API layer. This is the single implementation of every
 * dashboard operation an agent can run. The whole object is exposed as `oi` inside a node:vm by
 * Code Mode's one `execute` tool (see codemode.ts + server.ts), so a script composes many
 * operations in a single call instead of paying a tool schema + a round-trip per step.
 *
 * Result contract: every method returns a plain, JSON-serializable object carrying `ok`
 * (the exception is getManifest, which returns the manifest document itself). The same
 * read-many / write-one safety holds — there is no raw file write; every manifest change
 * funnels through patchManifest/replaceManifest → dryCheck → a staged proposal → applyEdit,
 * which snapshots the prior state for rollback.
 *
 * Engine lifecycle: the compiler caches one DuckDB engine per project dir. A method that
 * reads through it calls {@link ensureFresh} (reset-if-dirty), and a method that writes calls
 * markDirty — so within one Code Mode script a loop of reads reuses the engine (no quadratic
 * rebuilds) while a read after a write still sees the new data. A fresh api is built per tool
 * call / per script, so each starts dirty and picks up any change made on disk out-of-band.
 */
import { z } from "zod";
import { ActionValidationError, actionRowSchema, checkManifestContracts, checkQueries, deleteRows, inferSchema, insertRows as insertRowsCompiler, inspectManifestDatasets, listConnectorStatuses, query, queryColumns, queryParamSchema, queryRaw, QueryValidationError, readManifest as readProjectManifest, replaceRows, resetEngine, runConnectorSync, runQuery as runQueryCompiler, updateRows, validateRows, validateSql as validateSqlCompiler } from "@openislands/compiler";
import { BUILTIN_ISLAND_SCHEMAS, BUILTIN_ISLAND_TYPES, ISLAND_DEFAULT_SPAN, ISLAND_MAX_SPAN, ISLAND_MIN_SPAN, LayoutRow, jsonSchemaFor, lintManifest, validateManifest, type IslandError, type IslandType, type LayoutWarning, type Manifest } from "@openislands/schema";
import { type AppStateStore, type ContentStore } from "@openislands/storage";
import { createTwoFilesPatch } from "diff";
import { type CheckpointStore } from "./checkpoints.js";
import { confineDatasetSource } from "./paths.js";
import { hashManifest, type ProposalStore, type StoredProposal } from "./proposals.js";
import { recordManifestResend, recordRejection } from "./telemetry.js";

/** Max rows a single action insert may append. */
const MAX_ROWS_PER_ACTION = 100;

/** Cap on retained rollback checkpoints — applyEdit auto-prunes to this so history can't grow unbounded. */
const MAX_CHECKPOINTS = 25;

/** Output-size guardrails for the row-returning reads (runSql / runQuery). `concise` keeps a result
 * well inside a typical context budget; `detailed` allows a larger pull. Kept INSIDE these methods
 * (not a tool wrapper) so the cap holds whether they're called as a tool or composed inside a script. */
const ROW_BUDGET_CHARS = { concise: 10_000 * 4, detailed: 25_000 * 4 } as const;

export type Verbosity = "concise" | "detailed";

/** Everything a method needs to operate on one app, all rooted at the app's own dir. Built once
 * per app by the server's memoized factory and threaded into {@link createAppApi}. */
export interface AppContext {
  id: string;
  dir: string;
  content: ContentStore;
  appState: AppStateStore;
  proposals: ProposalStore;
  checkpoints: CheckpointStore;
}

/** Cross-cutting hooks Code Mode threads in: a deadline signal (so a timed-out script stops
 * starting NEW operations even if an in-flight one can't be cancelled) and a checkpoint sink
 * (so execute can report every checkpoint a script created — the audit trail for a half-failed run). */
export interface ApiRuntime {
  signal?: AbortSignal;
  onCheckpoint?: (id: string) => void;
}

interface IslandLayout {
  minSpan: number;
  recommendedSpan: number;
  maxSpan: number;
}

const layoutFor = (type: IslandType): IslandLayout => ({
  minSpan: ISLAND_MIN_SPAN[type],
  recommendedSpan: ISLAND_DEFAULT_SPAN[type],
  maxSpan: ISLAND_MAX_SPAN[type],
});

function usageExampleNotes(type: IslandType): string[] {
  if (type === "table.grid" || type === "timeline.feed") {
    return [
      `drilldown embeds an island in a clicked row's details dialog; \`match\` maps the embedded dataset's column → the clicked row's field. Example: {"island":{"type":"table.grid","dataset":"line_items","columns":["sku","qty"]},"match":{"order_id":"id"}}`,
    ];
  }
  if (type === "gauge.goal") {
    return [
      `each goal reads the last row's \`value\`; \`goal\` needs at least one of min/max (both = a target band). Example goals entry: {"value":"protein_g","goal":{"min":120},"label":"Protein","unit":"g"}`,
    ];
  }
  if (type === "content.editor") {
    return [
      `set exactly one of \`file\` (one doc) or \`dir\` (a tree). Single file: {"type":"content.editor","file":"docs/runbook.md"}. Directory: {"type":"content.editor","dir":"docs","groups":[{"id":"guides","match":["guides/**"]}]}`,
    ];
  }
  return [];
}

function layoutNotes(type: IslandType): string[] {
  const { minSpan, recommendedSpan, maxSpan } = layoutFor(type);
  const notes = [`Spans ${minSpan}–${maxSpan} columns; ${recommendedSpan} is the recommended width.`];
  if (maxSpan < 12) notes.push(`A compact island — keep it ≤ ${maxSpan}; past ~${recommendedSpan} it only stretches into empty space.`);
  if (maxSpan === 12) notes.push("Can run the full 12 columns when the data is dense.");
  if (type === "metric.kpi") notes.push("Avoid a standalone KPI — group 2+ in a row, or use metric.scorecard for a tidy strip.");
  return notes;
}

type ContractSchema = { required?: string[]; properties?: Record<string, unknown>; description: string };

/** Required + optional property NAMES from an island's input JSON Schema, dropping the `type` discriminant. */
function fieldNames(schema: ContractSchema): { required: string[]; optional: string[] } {
  const required = (schema.required ?? []).filter((field) => field !== "type");
  const optional = Object.keys(schema.properties ?? {}).filter((field) => field !== "type" && !required.includes(field));
  return { required, optional };
}

function islandContract(type: IslandType): { type: IslandType; required: string[]; optional: string[]; bindsData: boolean; description: string } & IslandLayout {
  const schema = z.toJSONSchema(BUILTIN_ISLAND_SCHEMAS[type], { io: "input" }) as ContractSchema;
  const { required, optional } = fieldNames(schema);
  return { type, required, optional, bindsData: required.includes("dataset"), description: schema.description, ...layoutFor(type) };
}

const LAYOUT_ROW_CONTRACT = (() => {
  const schema = z.toJSONSchema(LayoutRow) as ContractSchema;
  const { required, optional } = fieldNames(schema);
  return { type: "layout.row", required, optional, bindsData: false, description: schema.description };
})();

/** Every type getIslandSchema accepts: the built-ins plus the structural row. */
const ISLAND_TYPE_NAMES: string[] = [...BUILTIN_ISLAND_TYPES, "layout.row"];

function parseManifest(raw: string): { raw: unknown } | { error: string } {
  try {
    return { raw: JSON.parse(raw) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A manifest may arrive as a JSON object (preferred — no double-encoding) or a JSON string. */
function coerceManifest(input: string | Record<string, unknown>): { raw: unknown } | { error: string } {
  return typeof input === "string" ? parseManifest(input) : { raw: input };
}

/** The starter manifest a freshly-created app ships with — one note island prompting the agent to
 * drop in data. Kept minimal on purpose: the CLI owns real templating, not the MCP server. */
export const minimalManifest = (title: string): string =>
  JSON.stringify(
    {
      version: 1,
      title,
      datasets: {},
      pages: [
        {
          id: "overview",
          title: "Overview",
          islands: [{ type: "note.card", title: "Welcome", span: 12, markdown: "# New app\n\nDrop a data file into `data/`, then ask your agent to build from it." }],
        },
      ],
    },
    null,
    2,
  ) + "\n";

function manifestDiff(base: string, proposed: string): string {
  if (base === proposed) return "(no changes)";
  return createTwoFilesPatch("manifest.json", "manifest.json", base, proposed);
}

/** Trim a row set to a character budget, returning whether it was truncated. */
function capRows(rows: Record<string, unknown>[], budgetChars: number): { rows: Record<string, unknown>[]; truncated: boolean } {
  const out: Record<string, unknown>[] = [];
  let total = 0;
  for (const row of rows) {
    total += JSON.stringify(row).length + 2;
    if (out.length > 0 && total > budgetChars) return { rows: out, truncated: true };
    out.push(row);
  }
  return { rows: out, truncated: false };
}

/** Shared success envelope for the row-returning reads: cap rows to the verbosity budget and add a
 * steering note when truncated. */
function rowsResult(rows: Record<string, unknown>[], verbosity: Verbosity, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const capped = capRows(rows, ROW_BUDGET_CHARS[verbosity]);
  const note = capped.truncated
    ? { truncated: true, note: `Output capped at ~${verbosity === "detailed" ? 25 : 10}k tokens — narrow the query (tighter WHERE/SELECT or lower limit)${verbosity === "concise" ? ", or pass verbosity:'detailed'" : ""}.` }
    : {};
  return { ok: true, rowCount: capped.rows.length, ...extra, rows: capped.rows, ...note };
}

const RECORD_SECTIONS = ["datasets", "actions", "queries", "connectors"] as const;

/**
 * Merge a section-level patch into the current manifest object and return a new one.
 * Record sections upsert by key (a `null` value deletes that key); pages upsert by `id`;
 * `remove_pages` drops ids. `datasets` is kept present even when emptied; other emptied
 * sections are dropped.
 */
function applyManifestPatch(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  if (typeof patch.title === "string") merged.title = patch.title;
  if (typeof patch.icon === "string") merged.icon = patch.icon;

  for (const section of RECORD_SECTIONS) {
    const ops = patch[section] as Record<string, unknown> | undefined;
    if (!ops) continue;
    const next: Record<string, unknown> = { ...(merged[section] as Record<string, unknown> | undefined) };
    for (const [name, value] of Object.entries(ops)) {
      if (value === null) delete next[name];
      else next[name] = value;
    }
    if (section === "datasets" || Object.keys(next).length > 0) merged[section] = next;
    else delete merged[section];
  }

  const removePages = patch.remove_pages as string[] | undefined;
  const upsertPages = patch.pages as Array<{ id: string }> | undefined;
  if (upsertPages || removePages) {
    const removed = new Set(removePages ?? []);
    const pages = (Array.isArray(merged.pages) ? (merged.pages as Array<{ id: string }>) : []).filter((p) => !removed.has(p.id));
    for (const page of upsertPages ?? []) {
      const at = pages.findIndex((p) => p.id === page.id);
      if (at >= 0) pages[at] = page;
      else pages.push(page);
    }
    merged.pages = pages;
  }

  return merged;
}

/** Declared actions + (when detailed) their resolved row JSON Schema. Assumes a fresh engine. */
async function describeActions(dir: string, manifest: Manifest, detailed: boolean) {
  const out = [];
  for (const [name, spec] of Object.entries(manifest.actions ?? {})) {
    const base = { name, dataset: spec.dataset, mode: spec.mode, description: spec.description };
    out.push(detailed ? { ...base, rowSchema: z.toJSONSchema(await actionRowSchema(dir, name)) } : base);
  }
  return out;
}

/** Declared queries + (when detailed) their params JSON Schema and result columns. */
async function describeQueries(dir: string, manifest: Manifest, detailed: boolean) {
  const out = [];
  for (const [name, spec] of Object.entries(manifest.queries ?? {})) {
    if (!detailed) {
      out.push({ name, description: spec.description });
      continue;
    }
    let params: unknown = {};
    let columns: unknown[] = [];
    try {
      params = z.toJSONSchema(await queryParamSchema(dir, name));
    } catch {
      /* surfaced by validate */
    }
    try {
      columns = await queryColumns(dir, name);
    } catch {
      /* surfaced by validate */
    }
    out.push({ name, description: spec.description, params, columns });
  }
  return out;
}

export interface DryCheckResult {
  ok: boolean;
  errors: (IslandError | string)[];
  warnings: LayoutWarning[];
  custom: string[];
}

/** Dry contract check: validate a proposed manifest and check islands/queries against the live data.
 * Uses a throwaway engine (inspectManifestDatasets), so it never touches the cached one. */
async function dryCheck(dir: string, proposedRaw: unknown): Promise<DryCheckResult> {
  const v = validateManifest(proposedRaw);
  if (!v.ok || !v.manifest) return { ok: false, errors: v.errors, warnings: [], custom: [] };
  const warnings = lintManifest(v.manifest);

  for (const [name, spec] of Object.entries(v.manifest.datasets)) {
    const ref = spec.sql ?? spec.source;
    if (!ref) continue;
    try {
      confineDatasetSource(dir, ref);
    } catch (e) {
      return { ok: false, errors: [`dataset '${name}': ${(e as Error).message}`], warnings, custom: [] };
    }
  }

  const { columns, failures } = await inspectManifestDatasets(dir, v.manifest);
  const columnsFor = async (dataset: string): Promise<Set<string> | null> => {
    const cols = columns.get(dataset);
    return cols ? new Set(cols.map((c) => c.name)) : null;
  };
  const { errors } = await checkManifestContracts(dir, v.manifest, columnsFor);
  const queryErrors = await checkQueries(dir, v.manifest, async (dataset) => columns.get(dataset) ?? null);
  const allErrors = [
    ...[...failures].map(([name, message]) => `dataset '${name}': ${message}`),
    ...errors,
    ...queryErrors.map((e) => `query '${e.query}': ${e.message}`),
  ];
  return { ok: allErrors.length === 0, errors: allErrors, warnings, custom: v.custom.map((c) => c.type) };
}

/** The patch shape patchManifest accepts (section-level upserts). */
export interface ManifestPatch {
  title?: string;
  icon?: string;
  datasets?: Record<string, unknown>;
  actions?: Record<string, unknown>;
  queries?: Record<string, unknown>;
  connectors?: Record<string, unknown>;
  pages?: Array<Record<string, unknown>>;
  remove_pages?: string[];
}

/** The per-app API — every dashboard operation, one implementation. */
export interface AppApi {
  getOverview(opts?: { verbosity?: Verbosity }): Promise<Record<string, unknown>>;
  getManifest(): Promise<unknown>;
  listIslands(): Promise<Record<string, unknown>>;
  getIslandSchema(type: string): Promise<Record<string, unknown>>;
  getDataSchema(dataset: string): Promise<Record<string, unknown>>;
  runSql(input: { sql?: string; dataset?: string; limit?: number; verbosity?: Verbosity }): Promise<Record<string, unknown>>;
  previewDataset(dataset: string, opts?: { limit?: number; verbosity?: Verbosity }): Promise<Record<string, unknown>>;
  validateSql(sql: string): Promise<Record<string, unknown>>;
  validateManifest(manifest?: string | Record<string, unknown>): Promise<DryCheckResult | { ok: boolean; error: string }>;
  listCheckpoints(): Promise<Record<string, unknown>>;
  pruneCheckpoints(keep?: number): Promise<Record<string, unknown>>;
  replaceManifest(manifest: string | Record<string, unknown>): Promise<Record<string, unknown>>;
  patchManifest(patch: ManifestPatch): Promise<Record<string, unknown>>;
  applyEdit(proposalId: string): Promise<Record<string, unknown>>;
  rollback(checkpointId?: string): Promise<Record<string, unknown>>;
  listActions(): Promise<Record<string, unknown>>;
  runActions(calls: { action: string; rows?: Record<string, unknown>[]; match?: Record<string, unknown>; set?: Record<string, unknown> }[], opts?: { atomic?: boolean }): Promise<Record<string, unknown>>;
  listQueries(): Promise<Record<string, unknown>>;
  runQuery(name: string, params?: Record<string, unknown>, opts?: { limit?: number; verbosity?: Verbosity }): Promise<Record<string, unknown>>;
  listConnectors(): Promise<Record<string, unknown>>;
  runSync(name: string): Promise<Record<string, unknown>>;
}

/** Build the API for one app. `runtime` carries Code Mode's deadline signal + checkpoint sink — the
 * `execute` handler always provides them; the default just keeps the factory usable bare (e.g. tests). */
export function createAppApi(ctx: AppContext, runtime: ApiRuntime = {}): AppApi {
  let dirty = true;
  const ensureFresh = (): void => {
    if (!dirty) return;
    resetEngine(ctx.dir);
    dirty = false;
  };
  const markDirty = (): void => {
    dirty = true;
  };
  const checkAbort = (): void => {
    if (runtime.signal?.aborted) throw new Error("script deadline exceeded — no new operations started (in-flight ones may still complete; they are checkpointed)");
  };
  const recordCheckpoint = (result: Record<string, unknown>): Record<string, unknown> => {
    if (typeof result.checkpoint_id === "string") runtime.onCheckpoint?.(result.checkpoint_id);
    return result;
  };

  const readManifestText = async (): Promise<string> => (await ctx.content.readText("manifest.json")) ?? "{}";

  /** The shared body of runSql + previewDataset. Extracted to a local closure because the methods
   * live in a returned object literal whose `this` doesn't survive the Code Mode vm — calling it
   * directly keeps both entry points wired to one implementation. */
  const readRows = async ({ sql, dataset, limit = 50, verbosity = "concise" }: { sql?: string; dataset?: string; limit?: number; verbosity?: Verbosity }): Promise<Record<string, unknown>> => {
    if (dataset && sql) return { ok: false, error: "Pass either `dataset` or `sql`, not both." };
    if (!dataset && !sql) return { ok: false, error: "Pass a `dataset` name or a read-only `sql` SELECT." };
    ensureFresh();
    try {
      const result = sql ? await queryRaw(ctx.dir, sql, { limit }) : await query(ctx.dir, dataset!, { limit });
      return rowsResult(result.rows as Record<string, unknown>[], verbosity);
    } catch (e) {
      return { ok: false, error: `Query failed: ${(e as Error).message}` };
    }
  };

  /** Serialize a proposed manifest, diff it against the base, dry-check it, and either return the
   * validation errors or save a staged proposal. Shared by replaceManifest + patchManifest. */
  const stageProposal = async (base: string, manifest: unknown): Promise<Record<string, unknown>> => {
    const proposed = JSON.stringify(manifest, null, 2) + "\n";
    const diff = manifestDiff(base, proposed);
    const check = await dryCheck(ctx.dir, manifest);
    if (!check.ok) {
      void recordRejection(ctx.appState, check.errors);
      return { ok: false, errors: check.errors, warnings: check.warnings, diff };
    }
    await ctx.proposals.discardStale(hashManifest(base));
    const stored: StoredProposal = { manifest: proposed, diff, baseHash: hashManifest(base) };
    return { ok: true, proposal_id: await ctx.proposals.save(stored), custom_islands: check.custom, warnings: check.warnings, diff };
  };

  return {
    async getOverview({ verbosity = "concise" } = {}) {
      checkAbort();
      const raw = await readManifestText();
      const parsed = parseManifest(raw);
      if ("error" in parsed) return { ok: false, error: `manifest is not valid JSON: ${parsed.error}`, manifest_raw: raw };

      const checkpointIds = await ctx.checkpoints.list();
      const checkpoints = { count: checkpointIds.length, latest: checkpointIds.at(-1) ?? null };

      const v = validateManifest(parsed.raw);
      if (!v.ok || !v.manifest) return { ok: false, errors: v.errors, manifest: parsed.raw, checkpoints };

      ensureFresh();
      const detailed = verbosity === "detailed";
      const { columns, failures } = await inspectManifestDatasets(ctx.dir, v.manifest);
      const datasets = Object.fromEntries(
        Object.entries(v.manifest.datasets).map(([name, spec]) => [
          name,
          { source: spec.source ?? null, sql: spec.sql ?? null, description: spec.description, columns: columns.get(name) ?? null, error: failures.get(name) ?? null },
        ]),
      );
      return {
        ok: true,
        title: v.manifest.title,
        icon: v.manifest.icon ?? null,
        pages: v.manifest.pages,
        datasets,
        actions: await describeActions(ctx.dir, v.manifest, detailed),
        queries: await describeQueries(ctx.dir, v.manifest, detailed),
        connectors: await listConnectorStatuses(ctx.dir),
        custom_islands: v.custom.map((c) => c.type),
        checkpoints,
        hints: [
          "Read values back: previewDataset('<name>') (alias for runSql({ dataset })) returns rows from any dataset or sql transform — use it to verify a query/transform without hand-writing SQL.",
          "Edit incrementally: patchManifest deep-merges by section (datasets/actions/queries/connectors upsert by key; pages by id; a null value deletes a key) — send only the keys that change, then applyEdit the returned proposal_id. No need to resend the whole manifest.",
          "runActions dispatches by each action's mode: insert/replace take rows, delete takes match, update takes match+set (atomic by default — batch multiple calls in one rollback-safe write). runSync('<connector>') syncs on demand; both checkpoint automatically so you can rollback.",
        ],
      };
    },

    async getManifest() {
      checkAbort();
      const parsed = parseManifest(await readManifestText());
      if ("error" in parsed) throw new Error(`manifest is not valid JSON: ${parsed.error}`);
      return parsed.raw;
    },

    async listIslands() {
      checkAbort();
      return { ok: true, islands: [...BUILTIN_ISLAND_TYPES.map(islandContract), LAYOUT_ROW_CONTRACT] };
    },

    async getIslandSchema(type) {
      checkAbort();
      if (type === "layout.row") {
        return { ok: true, type, schema: z.toJSONSchema(LayoutRow), layout: null, notes: ["A structural full-width row; it carries no span of its own — set spans on its child islands."] };
      }
      if (!BUILTIN_ISLAND_TYPES.includes(type as IslandType)) return { ok: false, error: `Unknown built-in island '${type}'.`, known: ISLAND_TYPE_NAMES };
      const islandType = type as IslandType;
      return { ok: true, type: islandType, schema: jsonSchemaFor(islandType), layout: layoutFor(islandType), notes: [...layoutNotes(islandType), ...usageExampleNotes(islandType)] };
    },

    async getDataSchema(dataset) {
      checkAbort();
      ensureFresh();
      try {
        const schema = await inferSchema(ctx.dir, dataset);
        return { ok: true, dataset, columns: schema.columns };
      } catch (e) {
        return { ok: false, error: `Can't read dataset '${dataset}': ${(e as Error).message}` };
      }
    },

    async runSql(input) {
      checkAbort();
      return readRows(input);
    },

    async previewDataset(dataset, opts) {
      checkAbort();
      return readRows({ dataset, ...opts });
    },

    async validateSql(sql) {
      checkAbort();
      ensureFresh();
      return (await validateSqlCompiler(ctx.dir, sql)) as Record<string, unknown>;
    },

    async validateManifest(manifest) {
      checkAbort();
      const parsed = manifest === undefined ? parseManifest(await readManifestText()) : coerceManifest(manifest);
      if ("error" in parsed) return { ok: false, error: `Invalid JSON: ${parsed.error}` };
      return dryCheck(ctx.dir, parsed.raw);
    },

    async listCheckpoints() {
      checkAbort();
      return { ok: true, checkpoints: await ctx.checkpoints.list() };
    },

    async pruneCheckpoints(keep) {
      checkAbort();
      const { kept, removed } = await ctx.checkpoints.prune(keep ?? MAX_CHECKPOINTS);
      return { ok: true, kept, removed };
    },

    async replaceManifest(manifest) {
      checkAbort();
      void recordManifestResend(ctx.appState);
      const parsed = coerceManifest(manifest);
      if ("error" in parsed) return { ok: false, errors: [`Invalid JSON: ${parsed.error}`] };
      return stageProposal(await readManifestText(), parsed.raw);
    },

    async patchManifest(patch) {
      checkAbort();
      const base = await readManifestText();
      let current: Record<string, unknown>;
      try {
        current = JSON.parse(base) as Record<string, unknown>;
      } catch {
        current = {};
      }
      return stageProposal(base, applyManifestPatch(current, patch as Record<string, unknown>));
    },

    async applyEdit(proposalId) {
      checkAbort();
      const proposal = await ctx.proposals.load(proposalId);
      if (!proposal) return { ok: false, error: `Unknown proposal '${proposalId}'. Stage one with patchManifest or replaceManifest first.` };

      const base = await readManifestText();
      if (hashManifest(base) !== proposal.baseHash) {
        await ctx.proposals.remove(proposalId);
        return { ok: false, error: "stale proposal: the manifest changed since this edit was staged. Re-stage the edit." };
      }

      const checkpoint = (await ctx.content.exists("manifest.json")) ? await ctx.checkpoints.snapshotManifest(base) : null;
      await ctx.content.writeText("manifest.json", proposal.manifest);
      await ctx.proposals.remove(proposalId);
      await ctx.checkpoints.prune(MAX_CHECKPOINTS).catch(() => {});
      markDirty();
      return recordCheckpoint({ ok: true, checkpoint_id: checkpoint });
    },

    async rollback(checkpointId) {
      checkAbort();
      const available = await ctx.checkpoints.list();
      if (available.length === 0) return { ok: false, error: "no history yet", available };
      const target = checkpointId ?? available.at(-1)!;
      if (!available.includes(target)) return { ok: false, error: "checkpoint not found", available };

      const { restoredData } = await ctx.checkpoints.restore(target);
      if (restoredData) resetEngine(ctx.dir);
      markDirty();
      return { ok: true, restored: target };
    },

    async listActions() {
      checkAbort();
      const manifest = await readProjectManifest(ctx.dir);
      ensureFresh();
      return { ok: true, actions: await describeActions(ctx.dir, manifest, true) };
    },

    async runActions(calls, opts) {
      checkAbort();
      const atomic = opts?.atomic ?? true;
      if (calls.length === 0) return { ok: false, error: "no actions to run" };

      const manifest = await readProjectManifest(ctx.dir);
      ensureFresh();

      const plans = [];
      for (let index = 0; index < calls.length; index += 1) {
        const { action: name, rows, match, set } = calls[index]!;
        const action = manifest.actions?.[name];
        if (!action) {
          const declared = Object.keys(manifest.actions ?? {});
          plans.push({ action: name, index, mode: "insert", source: undefined, error: `unknown action '${name}'. Declared: ${declared.length ? declared.join(", ") : "(none)"}` });
          continue;
        }
        const mode = action.mode;
        const source = manifest.datasets[action.dataset]?.source;
        if (!source) {
          plans.push({ action: name, index, mode, source: undefined, error: `action '${name}' targets a non-writable dataset '${action.dataset}'` });
          continue;
        }
        try {
          confineDatasetSource(ctx.dir, source);
        } catch (e) {
          plans.push({ action: name, index, mode, source: undefined, error: (e as Error).message });
          continue;
        }
        if (mode === "insert" || mode === "replace") {
          if (!rows || rows.length === 0) {
            plans.push({ action: name, index, mode, source: undefined, error: `${mode} needs a non-empty rows array` });
            continue;
          }
          if (rows.length > MAX_ROWS_PER_ACTION) {
            plans.push({ action: name, index, mode, source: undefined, error: `too many rows: ${rows.length} > ${MAX_ROWS_PER_ACTION} per call` });
            continue;
          }
          const { errors } = validateRows(await actionRowSchema(ctx.dir, name), rows);
          plans.push({ action: name, index, mode, source, errors });
          continue;
        }
        if (mode === "delete") {
          if (!match || Object.keys(match).length === 0) {
            plans.push({ action: name, index, mode, source: undefined, error: "delete needs a non-empty match predicate" });
            continue;
          }
          plans.push({ action: name, index, mode, source });
          continue;
        }
        if (!match || Object.keys(match).length === 0) {
          plans.push({ action: name, index, mode, source: undefined, error: "update needs a non-empty match predicate" });
          continue;
        }
        if (!set || Object.keys(set).length === 0) {
          plans.push({ action: name, index, mode, source: undefined, error: "update needs a non-empty set patch" });
          continue;
        }
        plans.push({ action: name, index, mode, source });
      }

      const failed = (p: { error?: string; errors?: unknown[] }): boolean => p.error !== undefined || (p.errors?.length ?? 0) > 0;
      const invalid = plans.filter(failed);
      if (atomic && invalid.length > 0) {
        const failures = invalid.map((p) => (p.error !== undefined ? { action: p.action, index: p.index, error: p.error } : { action: p.action, index: p.index, errors: p.errors }));
        return { ok: false, atomic: true, failures };
      }

      const results: Record<string, unknown>[] = [];
      const checkpointIds: string[] = [];
      const completed: { source: string; checkpoint_id: string }[] = [];

      for (const plan of plans) {
        if (failed(plan)) {
          const failure = plan.error !== undefined ? { error: plan.error } : { errors: plan.errors };
          results.push({ action: plan.action, ok: false, ...failure });
          continue;
        }
        const { rows, match, set } = calls[plan.index]!;
        const { mode, action: name } = plan;
        try {
          let result;
          if (mode === "insert") result = await insertRowsCompiler(ctx.dir, name, rows!);
          else if (mode === "replace") result = await replaceRows(ctx.dir, name, rows!);
          else if (mode === "delete") result = await deleteRows(ctx.dir, name, match!);
          else result = await updateRows(ctx.dir, name, match!, set!);

          completed.push({ source: plan.source!, checkpoint_id: result.checkpoint_id ?? "" });
          results.push({ action: name, mode, ok: true, ...result });
          if (result.checkpoint_id) {
            checkpointIds.push(result.checkpoint_id);
            recordCheckpoint({ checkpoint_id: result.checkpoint_id });
          }
        } catch (e) {
          const message = e instanceof ActionValidationError ? e.message : (e as Error).message;
          if (!atomic) {
            results.push({ action: plan.action, ok: false, error: message });
            continue;
          }
          const rolledBack: string[] = [];
          for (const done of completed.toReversed()) {
            if (done.checkpoint_id) await ctx.checkpoints.restore(done.checkpoint_id);
            else await ctx.content.remove(done.source);
            rolledBack.push(done.checkpoint_id || done.source);
          }
          markDirty();
          return { ok: false, atomic: true, error: message, rolled_back: rolledBack };
        }
      }

      markDirty();
      if (atomic) return { ok: true, atomic: true, results, checkpoint_ids: checkpointIds };
      return { ok: results.every((r) => r.ok === true), atomic: false, results };
    },


    async listQueries() {
      checkAbort();
      const manifest = await readProjectManifest(ctx.dir);
      ensureFresh();
      return { ok: true, queries: await describeQueries(ctx.dir, manifest, true) };
    },

    async runQuery(name, params, opts) {
      checkAbort();
      const manifest = await readProjectManifest(ctx.dir);
      const spec = manifest.queries?.[name];
      if (!spec) {
        const declared = Object.keys(manifest.queries ?? {});
        return { ok: false, error: `unknown query '${name}'. Declared: ${declared.length ? declared.join(", ") : "(none)"}` };
      }
      ensureFresh();
      try {
        const result = await runQueryCompiler(ctx.dir, name, params ?? {}, { limit: opts?.limit ?? 100 });
        return rowsResult(result.rows as Record<string, unknown>[], opts?.verbosity ?? "concise", { columns: result.columns });
      } catch (e) {
        if (e instanceof QueryValidationError) return { ok: false, errors: e.errors };
        return { ok: false, error: (e as Error).message };
      }
    },

    async listConnectors() {
      checkAbort();
      return { ok: true, connectors: (await listConnectorStatuses(ctx.dir)) as unknown as Record<string, unknown>[] };
    },

    async runSync(name) {
      checkAbort();
      try {
        const result = await runConnectorSync(ctx.dir, name);
        markDirty();
        return recordCheckpoint({ ok: true, ...result });
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}
