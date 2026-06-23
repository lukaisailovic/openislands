/**
 * @openislands/mcp — the MCP server factory. This is the safety boundary that
 * lets an AI agent *maintain* a dashboard without it rotting.
 *
 * Read-many / write-one: many read/introspection tools, exactly one mutation
 * pipeline (replace_manifest / patch_manifest → validate → diff → apply_edit → rollback)
 * and NO raw filesystem write. Every proposed edit is validated against the island
 * schemas and checked against the data before a diff is even shown; nothing is written
 * until apply_edit, and the prior state is always snapshotted for rollback.
 *
 * Result contract: every tool returns a JSON object (never a bare value); fallible tools
 * carry `ok` plus `error`/`errors` in-band — `isError` is reserved for unexpected throws.
 * The high-value read + proposal tools also declare an `outputSchema` and return matching
 * `structuredContent` (mirrored as text for clients that don't consume it).
 */
import { mkdir, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { ActionValidationError, actionRowSchema, insertRows, checkManifestContracts, checkQueries, inferSchema, inspectManifestDatasets, listConnectorStatuses, query, queryColumns, queryParamSchema, queryRaw, QueryValidationError, readManifest as readProjectManifest, resetEngine, runConnectorSync, runQuery, validateSql } from "@openislands/compiler";
import { BUILTIN_ISLAND_SCHEMAS, BUILTIN_ISLAND_TYPES, ISLAND_DEFAULT_SPAN, ISLAND_MAX_SPAN, ISLAND_MIN_SPAN, LayoutRow, jsonSchemaFor, lintManifest, validateManifest, type IslandError, type IslandType, type LayoutWarning, type Manifest } from "@openislands/schema";
import { type AppStateStore, type ContentStore, getAppStateStore, getContentStore } from "@openislands/storage";
import { type CheckpointStore, createCheckpointStore, isCheckpointId } from "./checkpoints.js";
import { confineDatasetSource } from "./paths.js";
import { createProposalStore, hashManifest, type ProposalStore, type StoredProposal } from "./proposals.js";
import { isSafeAppId, scanApps } from "./workspace.js";

const MAX_ROWS_PER_ACTION = 100;

/** Cap on retained rollback checkpoints — apply_edit auto-prunes to this so history can't grow unbounded. */
const MAX_CHECKPOINTS = 25;

/** Output-size guardrails for the row-returning tools (run_sql / run_query). `concise` keeps a
 * result well inside a typical context budget; `detailed` allows a larger pull. A result past the
 * budget is truncated with a steering note so the agent narrows the query instead of drowning. */
const ROW_BUDGET_CHARS = { concise: 10_000 * 4, detailed: 25_000 * 4 } as const;

/** Read from package.json so the MCP handshake version tracks the published release (the release
 * workflow bumps package.json; this follows automatically). */
const SERVER_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

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

/** Layout guidance synthesized from an island's span bounds — kept generic so it tracks the
 * schema's numbers rather than a hand-maintained prose table that would drift from them. */
function layoutNotes(type: IslandType): string[] {
  const { minSpan, recommendedSpan, maxSpan } = layoutFor(type);
  const notes = [`Spans ${minSpan}–${maxSpan} columns; ${recommendedSpan} is the recommended width.`];
  if (maxSpan < 12) notes.push(`A compact island — keep it ≤ ${maxSpan}; past ~${recommendedSpan} it only stretches into empty space.`);
  if (maxSpan === 12) notes.push("Can run the full 12 columns when the data is dense.");
  if (type === "metric.kpi") notes.push("Avoid a standalone KPI — group 2+ in a row, or use metric.scorecard for a tidy strip.");
  return notes;
}

/** Required fields, data binding, description, and span range, derived from the island's Zod schema
 * and span maps so they can never drift from them. */
function islandContract(type: IslandType): { type: IslandType; required: string[]; bindsData: boolean; description: string } & IslandLayout {
  const schema = z.toJSONSchema(BUILTIN_ISLAND_SCHEMAS[type], { io: "input" }) as { required?: string[]; description: string };
  const required = (schema.required ?? []).filter((field) => field !== "type");
  return { type, required, bindsData: required.includes("dataset"), description: schema.description, ...layoutFor(type) };
}

const LAYOUT_ROW_CONTRACT = {
  type: "layout.row",
  required: ["islands"],
  bindsData: false,
  description: (z.toJSONSchema(LayoutRow) as { description: string }).description,
};

/**
 * Server-level usage guidance, surfaced to the model at connect time (MCP `instructions`).
 * This is the one place the read-many/write-one loop reaches a *generic* MCP client — the
 * richer SKILL.md / AGENTS.md only ship to Claude Code. Keep it tight; it's always in context.
 */
const INSTRUCTIONS = `OpenIslands maintains a typed dashboard ("manifest") of visual islands bound to local data files.

Multiple apps — call \`list_apps\`, then pass \`app\` on each tool (omit it when there's only one).

Read many, write one: read freely, but every change funnels through one validated, snapshotted pipeline — there is no raw file write.

ORIENT (cheapest first): get_overview returns the manifest, each dataset's live columns, and the declared actions/queries/connectors in ONE call — start here. Then ground island edits with list_islands and get_island_schema(type).

EDIT THE MANIFEST: patch_manifest (preferred — send only the sections that change) or replace_manifest (full rewrite). Both validate against the live data and return a unified diff + a proposal_id, and write NOTHING. If the result is ok:false, each error names the page/island/field — fix the binding and retry; never work around it. Then apply_edit({proposal_id}) writes the manifest and returns a checkpoint_id. rollback({checkpoint_id?}) undoes it byte-for-byte (latest if omitted).

DATA: list_actions -> run_action(name, rows) appends typed rows; list_queries -> run_query(name, params?) runs a declared typed read; run_sql / validate_sql are ad-hoc read-only SELECTs over the dataset views.

CONNECTORS: list_connectors -> run_sync(name). Authorizing a connector is human-only (the Connect button in the dashboard); if one isn't connected, tell the user — do not try to sync.

Every tool returns a JSON object with an \`ok\` flag; on ok:false read \`error\`/\`errors\` and fix the named field. Bind islands only to columns that exist; validate is the safety net, not an obstacle.`;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

/** Enveloped result, text-only — for tools without a declared outputSchema. */
const json = (v: Record<string, unknown>) => text(JSON.stringify(v, null, 2));

/** Enveloped result for a tool WITH an outputSchema: SDK ≥1.29 requires `structuredContent` on
 * every non-error result and validates it against the schema. The same object is mirrored as text
 * for clients that don't read structuredContent. */
const structured = (v: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }], structuredContent: v });

/** Annotations shared by every read/introspection tool: no mutation, repeatable, local-only.
 * The MCP spec's hints let a client auto-approve safe reads and gate the mutating tools. */
const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

/** Staging tools (replace_manifest / patch_manifest): they compute a diff and persist a *reversible*
 * proposal but change nothing observable — no manifest, no data. The real write gate is apply_edit,
 * so from the dashboard's perspective they read-only; idempotentHint is omitted (each call mints a
 * fresh proposal_id). Hinting readOnly lets a client stop gating safe staging and gate only apply. */
const STAGE_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** A real write that is reversible because it snapshots first (apply_edit). Not read-only, not
 * destructive (rollback restores it); idempotent — re-applying a consumed proposal is a no-op. */
const REVERSIBLE_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** An append that adds new state each call (run_action) — reversible (snapshotted) but not idempotent. */
const APPEND_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

/** Mutations that delete or overwrite prior state (rollback, history pruning) — flagged
 * destructive so a client can gate them; idempotent because re-running lands the same state. */
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

// --- output schemas (ZodRawShape) for the high-value read + proposal tools ----------------
// Success fields and error fields are both optional so a single object schema validates both the
// ok:true and the in-band ok:false result of a tool. Heavy/embedded payloads stay `z.unknown()`.

const islandContractShape = z.object({
  type: z.string(),
  required: z.array(z.string()),
  bindsData: z.boolean(),
  description: z.string().optional(),
  minSpan: z.number().optional(),
  recommendedSpan: z.number().optional(),
  maxSpan: z.number().optional(),
});

const LIST_ISLANDS_OUT = { ok: z.boolean(), islands: z.array(islandContractShape) };
const LIST_ACTIONS_OUT = { ok: z.boolean(), actions: z.array(z.object({ name: z.string(), dataset: z.string(), mode: z.string(), description: z.string().optional(), rowSchema: z.unknown().optional() })) };
const LIST_QUERIES_OUT = { ok: z.boolean(), queries: z.array(z.object({ name: z.string(), description: z.string().optional(), params: z.unknown().optional(), columns: z.array(z.unknown()).optional() })) };
const LIST_CONNECTORS_OUT = { ok: z.boolean(), connectors: z.array(z.record(z.string(), z.unknown())) };
const LIST_CHECKPOINTS_OUT = { ok: z.boolean(), checkpoints: z.array(z.string()) };
const DATA_SCHEMA_OUT = { ok: z.boolean(), dataset: z.string().optional(), columns: z.array(z.unknown()).optional(), error: z.string().optional() };
const ROWS_OUT = { ok: z.boolean(), rowCount: z.number().optional(), columns: z.array(z.unknown()).optional(), rows: z.array(z.record(z.string(), z.unknown())).optional(), truncated: z.boolean().optional(), note: z.string().optional(), errors: z.array(z.unknown()).optional(), error: z.string().optional() };
const VALIDATE_SQL_OUT = { ok: z.boolean(), columns: z.array(z.unknown()).optional(), error: z.string().optional() };
const VALIDATE_MANIFEST_OUT = { ok: z.boolean(), errors: z.array(z.unknown()).optional(), warnings: z.array(z.unknown()).optional(), custom: z.array(z.string()).optional(), error: z.string().optional() };
const PROPOSAL_OUT = { ok: z.boolean(), proposal_id: z.string().optional(), diff: z.string().optional(), warnings: z.array(z.unknown()).optional(), custom_islands: z.array(z.string()).optional(), errors: z.array(z.unknown()).optional() };

const verbosityArg = z.enum(["concise", "detailed"]).default("concise");

/** Every type get_island_schema accepts: the built-ins plus the structural row. Widened to
 * string[] so the (statically non-empty) list satisfies z.enum's non-empty-tuple type. */
const ISLAND_TYPE_NAMES: string[] = [...BUILTIN_ISLAND_TYPES, "layout.row"];
const ISLAND_TYPE_ENUM = ISLAND_TYPE_NAMES as [string, ...string[]];

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

const manifestArg = z.union([z.string(), z.record(z.string(), z.unknown())]);

/** The optional app selector carried by every app-scoped tool. Omitting it resolves to the sole
 * app when a workspace has exactly one; otherwise the tool errors and names the available ids. */
const appArg = z.string().optional().describe("which app (see list_apps); omit when there's only one");

const APPS_LIST_OUT = { ok: z.boolean(), apps: z.array(z.object({ id: z.string(), title: z.string(), dir: z.string() })), error: z.string().optional() };

/** The starter manifest a freshly-created app ships with — one note island prompting the agent to
 * drop in data. Kept minimal on purpose: the CLI owns real templating, not the MCP server. */
const minimalManifest = (title: string): string =>
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
  return createTwoFilesPatch("app/manifest.json", "app/manifest.json", base, proposed);
}

/** Trim a row set to a character budget, returning whether it was truncated. The agent gets a
 * representative head plus a steering note rather than a context-blowing wall of rows. */
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

/** Shared success envelope for the row-returning reads (run_sql / run_query): cap rows to the
 * verbosity budget and add a steering note when the result was truncated. */
function rowsResult(rows: Record<string, unknown>[], verbosity: "concise" | "detailed", extra: Record<string, unknown> = {}): Record<string, unknown> {
  const capped = capRows(rows, ROW_BUDGET_CHARS[verbosity]);
  const note = capped.truncated
    ? { truncated: true, note: `Output capped at ~${verbosity === "detailed" ? 25 : 10}k tokens — narrow the query (tighter WHERE/SELECT or lower limit)${verbosity === "concise" ? ", or pass verbosity:'detailed'" : ""}.` }
    : {};
  return { ok: true, rowCount: capped.rows.length, ...extra, rows: capped.rows, ...note };
}

const RECORD_SECTIONS = ["datasets", "actions", "queries", "connectors"] as const;

/**
 * Merge a section-level patch into the current manifest object and return a new one.
 * Record sections (datasets/actions/queries/connectors) upsert by key — a `null` value
 * deletes that key. Pages upsert by `id`; `remove_pages` drops ids. `datasets` is always
 * kept present (it's required) even when emptied; other emptied sections are dropped.
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

/** Everything a tool needs to operate on one app, all rooted at the app's own dir: its storage
 * ports, the proposal + checkpoint stores, and the resolved app id/dir. Built once per app by
 * {@link createServer}'s memoized factory and threaded into every app-scoped handler. */
interface AppContext {
  id: string;
  dir: string;
  content: ContentStore;
  appState: AppStateStore;
  proposals: ProposalStore;
  checkpoints: CheckpointStore;
}

/** Returned by `resolveApp` on failure — surfaced to the caller as `{ ok:false, error }` instead
 * of throwing, matching the in-band error contract every handler already uses. */
interface AppResolutionError {
  error: string;
}

const isResolutionError = (r: AppContext | AppResolutionError): r is AppResolutionError => "error" in r;

const readManifest = async (ctx: AppContext): Promise<string> => (await ctx.content.readText("app/manifest.json")) ?? "{}";

/** Dry contract check: validate a proposed manifest and check islands against the live data.
 * `warnings` are advisory layout lints over any structurally-valid manifest — they never affect `ok`. */
async function dryCheck(ctx: AppContext, proposedRaw: unknown): Promise<{ ok: boolean; errors: (IslandError | string)[]; warnings: LayoutWarning[]; custom: string[] }> {
  const v = validateManifest(proposedRaw);
  if (!v.ok || !v.manifest) return { ok: false, errors: v.errors, warnings: [], custom: [] };
  const warnings = lintManifest(v.manifest);

  for (const [name, spec] of Object.entries(v.manifest.datasets)) {
    const ref = spec.sql ?? spec.source;
    if (!ref) continue;
    try {
      confineDatasetSource(ctx.dir, ref);
    } catch (e) {
      return { ok: false, errors: [`dataset '${name}': ${(e as Error).message}`], warnings, custom: [] };
    }
  }

  // Resolve datasets against the PROPOSED manifest (a throwaway engine), not the on-disk one,
  // so a brand-new dataset/transform/markdown source can be bound and validated before it's
  // written — and a broken one reports the real DuckDB reason instead of a blanket "unreadable".
  const { columns, failures } = await inspectManifestDatasets(ctx.dir, v.manifest);
  const columnsFor = async (dataset: string): Promise<Set<string> | null> => {
    const cols = columns.get(dataset);
    return cols ? new Set(cols.map((c) => c.name)) : null;
  };
  const { errors } = await checkManifestContracts(ctx.dir, v.manifest, columnsFor);
  const queryErrors = await checkQueries(ctx.dir, v.manifest, async (dataset) => columns.get(dataset) ?? null);
  const allErrors = [
    ...[...failures].map(([name, message]) => `dataset '${name}': ${message}`),
    ...errors,
    ...queryErrors.map((e) => `query '${e.query}': ${e.message}`),
  ];
  return { ok: allErrors.length === 0, errors: allErrors, warnings, custom: v.custom.map((c) => c.type) };
}

/** Serialize a proposed manifest, diff it against the base, dry-check it, and either return the
 * validation errors or save a staged proposal. The shared tail of replace_manifest and patch_manifest. */
async function stageProposal(ctx: AppContext, base: string, manifest: unknown): Promise<Record<string, unknown>> {
  const proposed = JSON.stringify(manifest, null, 2) + "\n";
  const diff = manifestDiff(base, proposed);
  const check = await dryCheck(ctx, manifest);
  if (!check.ok) return { ok: false, errors: check.errors, warnings: check.warnings, diff };
  await ctx.proposals.discardStale(hashManifest(base));
  const stored: StoredProposal = { manifest: proposed, diff, baseHash: hashManifest(base) };
  return { ok: true, proposal_id: await ctx.proposals.save(stored), custom_islands: check.custom, warnings: check.warnings, diff };
}

/** Declared actions + (when `detailed`) their resolved row JSON Schema. The grounding for
 * run_action; shared by list_actions and get_overview. Assumes a reset engine. `concise` skips
 * the per-action schema resolution (and its DuckDB round-trips) — list_actions has the detail. */
async function describeActions(ctx: AppContext, manifest: Manifest, detailed: boolean) {
  const out = [];
  for (const [name, spec] of Object.entries(manifest.actions ?? {})) {
    const base = { name, dataset: spec.dataset, mode: spec.mode, description: spec.description };
    out.push(detailed ? { ...base, rowSchema: z.toJSONSchema(await actionRowSchema(ctx.dir, name)) } : base);
  }
  return out;
}

/** Declared queries + (when `detailed`) their params JSON Schema and result columns. The grounding
 * for run_query; shared by list_queries and get_overview. A query that fails to resolve is surfaced
 * by validate. `concise` returns name + description only. */
async function describeQueries(ctx: AppContext, manifest: Manifest, detailed: boolean) {
  const out = [];
  for (const [name, spec] of Object.entries(manifest.queries ?? {})) {
    if (!detailed) {
      out.push({ name, description: spec.description });
      continue;
    }
    let params: unknown = {};
    let columns: unknown[] = [];
    try {
      params = z.toJSONSchema(await queryParamSchema(ctx.dir, name));
    } catch {
      /* surfaced by validate */
    }
    try {
      columns = await queryColumns(ctx.dir, name);
    } catch {
      /* surfaced by validate */
    }
    out.push({ name, description: spec.description, params, columns });
  }
  return out;
}

/** Best-effort manifest title for the apps list and the resource list — falls back to the id. */
async function appTitle(ctx: AppContext): Promise<string> {
  try {
    const parsed = JSON.parse(await readManifest(ctx)) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : ctx.id;
  } catch {
    return ctx.id;
  }
}

export function createServer(projectRoot: string): McpServer {
  const contexts = new Map<string, AppContext>();

  /** Build (once) the per-app context for `id`, rooted at `<root>/apps/<id>`. Memoized so the
   * storage ports, proposal store, and checkpoint store are stable for the life of the session. */
  function appCtx(id: string): AppContext {
    const cached = contexts.get(id);
    if (cached) return cached;
    const dir = join(projectRoot, "apps", id);
    const content = getContentStore(dir);
    const appState = getAppStateStore(dir);
    const ctx: AppContext = { id, dir, content, appState, proposals: createProposalStore(appState), checkpoints: createCheckpointStore(dir, appState, content) };
    contexts.set(id, ctx);
    return ctx;
  }

  /** Resolve the optional `app` selector to a per-app context. Explicit ids are validated and must
   * exist; an omitted id resolves to the sole app, or errors and names the candidates so the agent
   * can retry with `app`. Returns an in-band error rather than throwing. */
  function resolveApp(app?: string): AppContext | AppResolutionError {
    const apps = scanApps(projectRoot);
    if (app !== undefined) {
      if (!isSafeAppId(app)) return { error: `invalid app id '${app}'` };
      const match = apps.find((a) => a.id === app);
      if (!match) return { error: `unknown app '${app}'. Available: ${apps.length ? apps.map((a) => a.id).join(", ") : "(none)"}` };
      return appCtx(match.id);
    }
    if (apps.length === 1) return appCtx(apps[0]!.id);
    if (apps.length === 0) return { error: "no apps found under apps/" };
    return { error: `this workspace has multiple apps — pass \`app\`. Available: ${apps.map((a) => a.id).join(", ")}` };
  }

  const server = new McpServer({ name: "openislands", version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  // --- read-only introspection ----------------------------------------------------

  server.registerTool(
    "get_overview",
    {
      description:
        "START HERE. One-call orientation: the manifest, every dataset's live DuckDB-inferred columns, and the declared actions, queries (name + description), and connectors (live status), plus the rollback checkpoint count. Replaces a get_manifest + a get_data_schema per dataset + list_actions/list_queries/list_connectors fan-out. Pass verbosity:'detailed' to also include per-action row schemas and per-query params/columns. Then ground a specific island edit with list_islands / get_island_schema.",
      inputSchema: { app: appArg, verbosity: verbosityArg.describe("concise (default) omits per-action row schemas + per-query params/columns; detailed includes them (also via list_actions / list_queries)") },
      annotations: { title: "Dashboard overview", ...READ_ONLY },
    },
    async ({ app, verbosity }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return json({ ok: false, error: ctx.error });

      const raw = await readManifest(ctx);
      const parsed = parseManifest(raw);
      if ("error" in parsed) return json({ ok: false, error: `manifest is not valid JSON: ${parsed.error}`, manifest_raw: raw });

      const checkpointIds = await ctx.checkpoints.list();
      const checkpointsSummary = { count: checkpointIds.length, latest: checkpointIds.at(-1) ?? null };

      const v = validateManifest(parsed.raw);
      if (!v.ok || !v.manifest) return json({ ok: false, errors: v.errors, manifest: parsed.raw, checkpoints: checkpointsSummary });

      const detailed = verbosity === "detailed";
      const { columns, failures } = await inspectManifestDatasets(ctx.dir, v.manifest);
      const datasets = Object.fromEntries(
        Object.entries(v.manifest.datasets).map(([name, spec]) => [
          name,
          { source: spec.source ?? null, sql: spec.sql ?? null, description: spec.description, columns: columns.get(name) ?? null, error: failures.get(name) ?? null },
        ]),
      );

      const overview = {
        ok: true,
        title: v.manifest.title,
        icon: v.manifest.icon ?? null,
        pages: v.manifest.pages,
        datasets,
        actions: await describeActions(ctx, v.manifest, detailed),
        queries: await describeQueries(ctx, v.manifest, detailed),
        connectors: await listConnectorStatuses(ctx.dir),
        custom_islands: v.custom.map((c) => c.type),
        checkpoints: checkpointsSummary,
      };
      resetEngine(ctx.dir);
      return json(overview);
    },
  );

  server.registerTool(
    "list_islands",
    {
      description: "List the built-in island types with their required fields, a short description, and their span range (minSpan / recommendedSpan / maxSpan).",
      outputSchema: LIST_ISLANDS_OUT,
      annotations: { title: "List island types", ...READ_ONLY },
    },
    async () => structured({ ok: true, islands: [...BUILTIN_ISLAND_TYPES.map(islandContract), LAYOUT_ROW_CONTRACT] }),
  );

  server.registerTool(
    "get_island_schema",
    {
      description: "Get the JSON Schema for one island type plus its layout guidance (min/recommended/max span + notes) — use it to ground an edit and pick a sensible width.",
      inputSchema: { type: z.enum(ISLAND_TYPE_ENUM).describe("a built-in island type (e.g. 'metric.kpi', 'table.grid'), or 'layout.row' for a structural row") },
      annotations: { title: "Island schema", ...READ_ONLY },
    },
    async ({ type }) => {
      if (type === "layout.row") {
        return json({ ok: true, type, schema: z.toJSONSchema(LayoutRow), layout: null, notes: ["A structural full-width row; it carries no span of its own — set spans on its child islands."] });
      }
      if (!BUILTIN_ISLAND_TYPES.includes(type as IslandType)) return json({ ok: false, error: `Unknown built-in island '${type}'.`, known: ISLAND_TYPE_NAMES });
      const islandType = type as IslandType;
      return json({ ok: true, type: islandType, schema: jsonSchemaFor(islandType), layout: layoutFor(islandType), notes: layoutNotes(islandType) });
    },
  );

  server.registerTool(
    "get_manifest",
    { description: "Return the current app manifest verbatim (the raw JSON document).", inputSchema: { app: appArg }, annotations: { title: "Get manifest", ...READ_ONLY } },
    async ({ app }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return json({ ok: false, error: ctx.error });
      return text(await readManifest(ctx));
    },
  );

  server.registerTool(
    "get_data_schema",
    {
      description: "Columns and inferred types for a dataset (from the live data).",
      inputSchema: { app: appArg, dataset: z.string().describe("a dataset name declared in the manifest") },
      outputSchema: DATA_SCHEMA_OUT,
      annotations: { title: "Dataset schema", ...READ_ONLY },
    },
    async ({ app, dataset }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, error: ctx.error });
      resetEngine(ctx.dir);
      try {
        const schema = await inferSchema(ctx.dir, dataset);
        return structured({ ok: true, dataset, columns: schema.columns });
      } catch (e) {
        return structured({ ok: false, error: `Can't read dataset '${dataset}': ${(e as Error).message}` });
      }
    },
  );

  server.registerTool(
    "run_sql",
    {
      description:
        "Ad-hoc read over your files (read-only, row-capped). Pass `sql` for a single read-only SELECT over the registered dataset views, or `dataset` for a whole-dataset dump. Pairs with validate_sql (the dry-run). For a saved, named, parameterized read, declare a query and use run_query instead.",
      inputSchema: {
        app: appArg,
        dataset: z.string().optional().describe("a dataset name — returns the whole dataset (shorthand for SELECT * FROM <dataset>)"),
        sql: z.string().optional().describe("a single read-only SELECT over the dataset views, e.g. 'SELECT class, value_eur FROM allocation ORDER BY value_eur DESC'"),
        limit: z.number().int().positive().max(500).default(50).describe("max rows to return (1–500)"),
        verbosity: verbosityArg.describe("concise (default) caps output ~10k tokens; detailed ~25k — both still honor limit"),
      },
      outputSchema: ROWS_OUT,
      annotations: { title: "Run ad-hoc SQL", ...READ_ONLY },
    },
    async ({ app, dataset, sql, limit, verbosity }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, error: ctx.error });
      if (dataset && sql) return structured({ ok: false, error: "Pass either `dataset` or `sql`, not both." });
      if (!dataset && !sql) return structured({ ok: false, error: "Pass a `dataset` name or a read-only `sql` SELECT." });
      resetEngine(ctx.dir);
      try {
        const result = sql ? await queryRaw(ctx.dir, sql, { limit }) : await query(ctx.dir, dataset!, { limit });
        return structured(rowsResult(result.rows as Record<string, unknown>[], verbosity));
      } catch (e) {
        return structured({ ok: false, error: `Query failed: ${(e as Error).message}` });
      }
    },
  );

  server.registerTool(
    "validate_sql",
    {
      description:
        "Dry-run a read-only SELECT against the registered dataset views WITHOUT running it for real — returns the result columns if valid, or the exact DuckDB error (catalog / parse / type) if not. Author a `sql` transform body here and confirm it binds before wiring it into a dataset, or sanity-check a run_sql SELECT.",
      inputSchema: { app: appArg, sql: z.string().describe("a single read-only SELECT over the dataset views") },
      outputSchema: VALIDATE_SQL_OUT,
      annotations: { title: "Validate SQL", ...READ_ONLY },
    },
    async ({ app, sql }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, error: ctx.error });
      resetEngine(ctx.dir);
      return structured((await validateSql(ctx.dir, sql)) as Record<string, unknown>);
    },
  );

  server.registerTool(
    "validate_manifest",
    {
      description: "Dry-run validate a manifest (a JSON object or string, or the current one if omitted) and check island bindings against the data. Returns ok + errors (each naming the page/island/field) + advisory layout warnings.",
      inputSchema: { app: appArg, manifest: manifestArg.optional().describe("a full manifest object (preferred) or JSON string; omit to validate the one on disk") },
      outputSchema: VALIDATE_MANIFEST_OUT,
      annotations: { title: "Validate manifest", ...READ_ONLY },
    },
    async ({ app, manifest }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, error: ctx.error });
      const parsed = manifest === undefined ? parseManifest(await readManifest(ctx)) : coerceManifest(manifest);
      if ("error" in parsed) return structured({ ok: false, error: `Invalid JSON: ${parsed.error}` });
      return structured(await dryCheck(ctx, parsed.raw));
    },
  );

  server.registerTool(
    "list_checkpoints",
    { description: "List rollback checkpoints (prior manifests + data snapshots), newest last.", inputSchema: { app: appArg }, outputSchema: LIST_CHECKPOINTS_OUT, annotations: { title: "List checkpoints", ...READ_ONLY } },
    async ({ app }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, error: ctx.error });
      return structured({ ok: true, checkpoints: await ctx.checkpoints.list() });
    },
  );

  server.registerTool(
    "prune_checkpoints",
    {
      description: `Trim the rollback history, keeping the newest \`keep\` checkpoints and deleting the rest (defaults to ${MAX_CHECKPOINTS}). Older checkpoints become unrecoverable. History is auto-trimmed to ${MAX_CHECKPOINTS} on every apply_edit; call this to reclaim space sooner or to keep fewer. (Renamed from cleanup_history.)`,
      inputSchema: { app: appArg, keep: z.number().int().positive().optional().describe(`how many of the newest checkpoints to retain (default ${MAX_CHECKPOINTS})`) },
      annotations: { title: "Prune checkpoints", ...DESTRUCTIVE },
    },
    async ({ app, keep }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return json({ ok: false, error: ctx.error });
      const { kept, removed } = await ctx.checkpoints.prune(keep ?? MAX_CHECKPOINTS);
      return json({ ok: true, kept, removed });
    },
  );

  // --- the one write pipeline ------------------------------------------------------

  server.registerTool(
    "replace_manifest",
    {
      description:
        "Replace the WHOLE manifest — for a full rewrite or a brand-new manifest. Validates + checks data + returns a diff (and advisory layout `warnings`). Does NOT write — call apply_edit to commit. For a small change prefer patch_manifest: sending a full-manifest payload just to edit one section is error-prone (easy to drop or mangle the parts you didn't mean to touch). (Renamed from propose_edit.)",
      inputSchema: { app: appArg, manifest: manifestArg.describe("the full proposed manifest — a JSON object (preferred) or a JSON string") },
      outputSchema: PROPOSAL_OUT,
      annotations: { title: "Replace manifest", ...STAGE_ONLY },
    },
    async ({ app, manifest }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, errors: [ctx.error] });
      const parsed = coerceManifest(manifest);
      if ("error" in parsed) return structured({ ok: false, errors: [`Invalid JSON: ${parsed.error}`] });
      return structured(await stageProposal(ctx, await readManifest(ctx), parsed.raw));
    },
  );

  server.registerTool(
    "patch_manifest",
    {
      description:
        "The PREFERRED editor for incremental edits — send only the sections that change, so edits stay small and drift less. Add, replace, or remove individual datasets, actions, queries, connectors, and pages WITHOUT re-sending the whole manifest. Record sections take a map of name → spec (or name → null to delete). Pages take full Page objects, upserted by id; remove_pages deletes pages by id. To change one island, send just its page in `pages`. Ground island/dataset fields with get_island_schema(type) and get_data_schema(dataset) first. The patch is merged into the current manifest, validated, checked against the data, and returned as a diff + proposal_id (plus advisory layout `warnings`) — nothing is written until apply_edit. On ok:false each error names the page/island/field; fix and retry.",
      inputSchema: {
        app: appArg,
        title: z.string().optional().describe("dashboard title"),
        icon: z.string().optional().describe("workspace tile icon"),
        datasets: z.record(z.string(), z.unknown()).optional().describe("name → dataset spec (e.g. { source: 'data/x.csv' } or { sql: 'models/x.sql' }); name → null deletes it"),
        actions: z.record(z.string(), z.unknown()).optional().describe("name → action spec (e.g. { dataset, mode:'insert', fields }); name → null deletes it"),
        queries: z.record(z.string(), z.unknown()).optional().describe("name → query spec (declarative read: { dataset, select?, where?, params? }); name → null deletes it"),
        connectors: z.record(z.string(), z.unknown()).optional().describe("name → connector spec ({ module, datasets, schedule?, config? }); name → null deletes it"),
        pages: z.array(z.record(z.string(), z.unknown())).optional().describe("full Page objects, upserted by id (a matching id is replaced, a new id is appended)"),
        remove_pages: z.array(z.string()).optional().describe("page ids to remove"),
      },
      outputSchema: PROPOSAL_OUT,
      annotations: { title: "Patch manifest", ...STAGE_ONLY },
    },
    async ({ app, ...patch }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, errors: [ctx.error] });
      const base = await readManifest(ctx);
      let current: Record<string, unknown>;
      try {
        current = JSON.parse(base) as Record<string, unknown>;
      } catch {
        current = {};
      }
      return structured(await stageProposal(ctx, base, applyManifestPatch(current, patch as Record<string, unknown>)));
    },
  );

  server.registerTool(
    "apply_edit",
    {
      description: "Write a previously-staged edit (from replace_manifest or patch_manifest). Rejects stale/unknown proposals. Snapshots the current manifest first for rollback and returns its checkpoint_id.",
      inputSchema: { app: appArg, proposal_id: z.string().describe("the proposal_id returned by patch_manifest / replace_manifest") },
      annotations: { title: "Apply staged edit", ...REVERSIBLE_WRITE },
    },
    async ({ app, proposal_id }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return json({ ok: false, error: ctx.error });

      const proposal = await ctx.proposals.load(proposal_id);
      if (!proposal) return json({ ok: false, error: `Unknown proposal '${proposal_id}'. Stage one with patch_manifest or replace_manifest first.` });

      const base = await readManifest(ctx);
      if (hashManifest(base) !== proposal.baseHash) {
        await ctx.proposals.remove(proposal_id);
        return json({ ok: false, error: "stale proposal: the manifest changed since this edit was staged. Re-stage the edit." });
      }

      const checkpoint = (await ctx.content.exists("app/manifest.json")) ? await ctx.checkpoints.snapshotManifest(base) : null;
      await ctx.content.writeText("app/manifest.json", proposal.manifest);
      await ctx.proposals.remove(proposal_id);
      await ctx.checkpoints.prune(MAX_CHECKPOINTS).catch(() => {});

      return json({ ok: true, checkpoint_id: checkpoint });
    },
  );

  server.registerTool(
    "rollback",
    {
      description: "Restore a prior checkpoint byte-for-byte — a manifest edit or a data-action append (latest if none given). Restores the manifest and any data snapshot the checkpoint covers.",
      inputSchema: { app: appArg, checkpoint_id: z.string().optional().describe("a checkpoint_id from list_checkpoints; omit to restore the latest") },
      annotations: { title: "Roll back", ...DESTRUCTIVE },
    },
    async ({ app, checkpoint_id }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return json({ ok: false, error: ctx.error });

      const available = await ctx.checkpoints.list();
      if (available.length === 0) return json({ ok: false, error: "no history yet", available });
      if (checkpoint_id && !isCheckpointId(checkpoint_id)) return json({ ok: false, error: "invalid checkpoint id", available });
      const target = checkpoint_id ?? available.at(-1)!;
      if (!available.includes(target)) return json({ ok: false, error: "checkpoint not found", available });

      const { restoredData } = await ctx.checkpoints.restore(target);
      if (restoredData) resetEngine(ctx.dir);
      return json({ ok: true, restored: target });
    },
  );

  // --- data actions: typed appends into declared datasets --------------------------

  server.registerTool(
    "list_actions",
    { description: "List the manifest's declared data actions with their resolved row JSON Schema — the agent's grounding for run_action.", inputSchema: { app: appArg }, outputSchema: LIST_ACTIONS_OUT, annotations: { title: "List actions", ...READ_ONLY } },
    async ({ app }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, error: ctx.error });
      const manifest = await readProjectManifest(ctx.dir);
      resetEngine(ctx.dir);
      return structured({ ok: true, actions: await describeActions(ctx, manifest, true) });
    },
  );

  server.registerTool(
    "run_action",
    {
      description: "Append typed rows through a declared action. Validates every row against the action schema (all-or-nothing); on success snapshots the file and returns a rollback checkpoint_id.",
      inputSchema: {
        app: appArg,
        name: z.string().describe("a declared action name (see list_actions)"),
        rows: z.array(z.record(z.string(), z.unknown())).describe("rows to append, each matching the action's row schema, e.g. [{ class: 'BTC', value_eur: 50000 }]"),
      },
      annotations: { title: "Run action", ...APPEND_WRITE },
    },
    async ({ app, name, rows }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return json({ ok: false, error: ctx.error });

      const manifest = await readProjectManifest(ctx.dir);
      const action = manifest.actions?.[name];
      if (!action) {
        const declared = Object.keys(manifest.actions ?? {});
        return json({ ok: false, error: `unknown action '${name}'. Declared: ${declared.length ? declared.join(", ") : "(none)"}` });
      }
      if (rows.length === 0) return json({ ok: false, error: "no rows to insert" });
      if (rows.length > MAX_ROWS_PER_ACTION) return json({ ok: false, error: `too many rows: ${rows.length} > ${MAX_ROWS_PER_ACTION} per call` });

      const dataset = manifest.datasets[action.dataset];
      if (!dataset?.source) return json({ ok: false, error: `action '${name}' targets a non-writable dataset '${action.dataset}'` });
      try {
        confineDatasetSource(ctx.dir, dataset.source);
      } catch (e) {
        return json({ ok: false, error: (e as Error).message });
      }

      try {
        const result = await insertRows(ctx.dir, name, rows);
        return json({ ok: true, inserted: result.inserted, checkpoint_id: result.checkpoint_id });
      } catch (e) {
        if (e instanceof ActionValidationError) return json({ ok: false, errors: e.errors });
        return json({ ok: false, error: (e as Error).message });
      }
    },
  );

  // --- read queries: typed, parameterized reads -----------------------------------

  server.registerTool(
    "list_queries",
    { description: "List the manifest's declared read queries with their params JSON Schema and result columns — the agent's grounding for run_query.", inputSchema: { app: appArg }, outputSchema: LIST_QUERIES_OUT, annotations: { title: "List queries", ...READ_ONLY } },
    async ({ app }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, error: ctx.error });
      const manifest = await readProjectManifest(ctx.dir);
      resetEngine(ctx.dir);
      return structured({ ok: true, queries: await describeQueries(ctx, manifest, true) });
    },
  );

  server.registerTool(
    "run_query",
    {
      description: "Run a declared read-only query with typed params. Validates params first (all-or-nothing); returns rows. Read-only and row-capped — never writes. For ad-hoc SQL not saved in the manifest, use run_sql.",
      inputSchema: {
        app: appArg,
        name: z.string().describe("a declared query name (see list_queries)"),
        params: z.record(z.string(), z.unknown()).optional().describe("param name → value, matching the query's params schema, e.g. { class: 'BTC' }"),
        limit: z.number().int().positive().max(500).optional().describe("max rows to return (1–500; default 100)"),
        verbosity: verbosityArg.describe("concise (default) caps output ~10k tokens; detailed ~25k"),
      },
      outputSchema: ROWS_OUT,
      annotations: { title: "Run query", ...READ_ONLY },
    },
    async ({ app, name, params, limit, verbosity }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, error: ctx.error });
      const manifest = await readProjectManifest(ctx.dir);
      const spec = manifest.queries?.[name];
      if (!spec) {
        const declared = Object.keys(manifest.queries ?? {});
        return structured({ ok: false, error: `unknown query '${name}'. Declared: ${declared.length ? declared.join(", ") : "(none)"}` });
      }
      resetEngine(ctx.dir);
      try {
        const result = await runQuery(ctx.dir, name, params ?? {}, { limit: limit ?? 100 });
        return structured(rowsResult(result.rows as Record<string, unknown>[], verbosity, { columns: result.columns }));
      } catch (e) {
        if (e instanceof QueryValidationError) return structured({ ok: false, errors: e.errors });
        return structured({ ok: false, error: (e as Error).message });
      }
    },
  );

  // --- connectors: discover + pull data from external providers --------------------

  server.registerTool(
    "list_connectors",
    {
      description:
        "List the manifest's declared connectors with their live status: auth kind, whether they're connected, any missing secrets, schedule, last sync/error. This is how you discover that a connector needs authorizing — authorizing it is human-only (the Connect button in the dashboard / `openislands serve`), so when `connected` is false surface that to the user rather than trying to sync.",
      inputSchema: { app: appArg },
      outputSchema: LIST_CONNECTORS_OUT,
      annotations: { title: "List connectors", ...READ_ONLY },
    },
    async ({ app }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return structured({ ok: false, error: ctx.error });
      return structured({ ok: true, connectors: (await listConnectorStatuses(ctx.dir)) as unknown as Record<string, unknown>[] });
    },
  );

  server.registerTool(
    "run_sync",
    {
      description:
        "Run one connector sync now: pulls from the provider and writes rows into its `source` datasets through the checkpointed write path (covered by rollback). Returns per-dataset rows/mode/checkpoint. Fails if the connector isn't connected — check list_connectors first.",
      inputSchema: { app: appArg, name: z.string().describe("a declared connector name (see list_connectors)") },
      annotations: { title: "Run connector sync", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ app, name }) => {
      const ctx = resolveApp(app);
      if (isResolutionError(ctx)) return json({ ok: false, error: ctx.error });
      try {
        return json({ ok: true, ...(await runConnectorSync(ctx.dir, name)) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message });
      }
    },
  );

  // --- project-level: discover, scaffold, and archive apps -------------------------

  server.registerTool(
    "list_apps",
    {
      description: "List the workspace's apps with their id, manifest title (best-effort, falls back to id), and dir. Call this first to learn which `app` value to pass on the other tools — omit `app` only when there's exactly one.",
      outputSchema: APPS_LIST_OUT,
      annotations: { title: "List apps", ...READ_ONLY },
    },
    async () => {
      const apps = scanApps(projectRoot);
      const out = [];
      for (const { id, dir } of apps) out.push({ id, title: await appTitle(appCtx(id)), dir });
      return structured({ ok: true, apps: out });
    },
  );

  server.registerTool(
    "create_app",
    {
      description: "Scaffold a new app under apps/<id>/ with a minimal starter manifest and empty data/, models/, docs/ dirs. The id must be a safe path segment and must not already exist. No templating — that's the CLI's job; build the app up with patch_manifest afterwards.",
      inputSchema: {
        id: z.string().describe("the new app id — one safe path segment (letters, digits, '.', '_', '-')"),
        title: z.string().optional().describe("the dashboard title; defaults to the id"),
      },
      annotations: { title: "Create app", ...REVERSIBLE_WRITE, idempotentHint: false },
    },
    async ({ id, title }) => {
      if (!isSafeAppId(id)) return json({ ok: false, error: `invalid app id '${id}' — use one safe path segment (letters, digits, '.', '_', '-')` });
      const dir = join(projectRoot, "apps", id);
      if (existsSync(dir)) return json({ ok: false, error: `app '${id}' already exists` });

      for (const sub of ["app", "data", "models", "docs"]) await mkdir(join(dir, sub), { recursive: true });
      await getContentStore(dir).writeText("app/manifest.json", minimalManifest(title ?? id));
      contexts.delete(id);
      return json({ ok: true, id, dir });
    },
  );

  server.registerTool(
    "delete_app",
    {
      description: "Soft-archive an app: move apps/<id>/ into .openislands/trash/<id>-<timestamp>/ so it disappears from the workspace but is fully recoverable. Never a hard delete.",
      inputSchema: { id: z.string().describe("the app id to archive (see list_apps)") },
      annotations: { title: "Archive app", ...DESTRUCTIVE },
    },
    async ({ id }) => {
      if (!isSafeAppId(id)) return json({ ok: false, error: `invalid app id '${id}'` });
      const dir = join(projectRoot, "apps", id);
      if (!existsSync(dir)) return json({ ok: false, error: `unknown app '${id}'` });

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const trashDir = join(projectRoot, ".openislands", "trash");
      const archivedTo = join(trashDir, `${id}-${stamp}`);
      await mkdir(trashDir, { recursive: true });
      await rename(dir, archivedTo);
      contexts.delete(id);
      return json({ ok: true, archivedTo });
    },
  );

  // --- resources: the app catalog + per-app manifests ------------------------------

  server.registerResource(
    "apps",
    "openislands://apps",
    { title: "Apps", description: "The workspace's apps (id + title).", mimeType: "application/json" },
    async (uri) => {
      const apps = scanApps(projectRoot);
      const list = [];
      for (const { id } of apps) list.push({ id, title: await appTitle(appCtx(id)) });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ apps: list }, null, 2) }] };
    },
  );

  server.registerResource(
    "app-manifest",
    new ResourceTemplate("openislands://apps/{id}/manifest.json", {
      list: async () => {
        const apps = scanApps(projectRoot);
        return { resources: apps.map(({ id }) => ({ name: `${id} manifest`, uri: `openislands://apps/${id}/manifest.json`, mimeType: "application/json" })) };
      },
    }),
    { title: "App manifest", description: "One app's manifest.json.", mimeType: "application/json" },
    async (uri, { id }) => {
      const appId = Array.isArray(id) ? id[0] : id;
      if (!appId || !isSafeAppId(appId)) throw new Error(`invalid app id '${appId}'`);
      if (!scanApps(projectRoot).some((a) => a.id === appId)) throw new Error(`unknown app '${appId}'`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: await readManifest(appCtx(appId)) }] };
    },
  );

  return server;
}
