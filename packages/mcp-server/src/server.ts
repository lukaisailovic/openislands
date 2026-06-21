/**
 * @openislands/mcp — the MCP server factory. This is the safety boundary that
 * lets an AI agent *maintain* a dashboard without it rotting.
 *
 * Read-many / write-one: many read/introspection tools, exactly one mutation
 * pipeline (propose_edit → validate → diff → apply_edit → rollback) and NO raw
 * filesystem write. Every proposed edit is validated against the island schemas
 * and checked against the data before a diff is even shown; nothing is written
 * until apply_edit, and the prior state is always snapshotted for rollback.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { ActionValidationError, actionRowSchema, insertRows, checkManifestContracts, checkQueries, inferSchema, inspectManifestDatasets, listConnectorStatuses, query, queryColumns, queryParamSchema, queryRaw, QueryValidationError, readManifest as readProjectManifest, resetEngine, runConnectorSync, runQuery, validateSql } from "@openislands/compiler";
import { ActionSpec, BUILTIN_ISLAND_SCHEMAS, BUILTIN_ISLAND_TYPES, ConnectorSpec, DatasetSpec, LayoutRow, Page, QuerySpec, jsonSchemaFor, validateManifest, type IslandError, type IslandType } from "@openislands/schema";
import { getAppStateStore, getContentStore } from "@openislands/storage";
import { createCheckpointStore, isCheckpointId } from "./checkpoints.js";
import { confineDatasetSource } from "./paths.js";
import { createProposalStore, hashManifest, type StoredProposal } from "./proposals.js";

const MAX_ROWS_PER_ACTION = 100;

/** Read from package.json so the MCP handshake version tracks the published release (the release
 * workflow bumps package.json; this follows automatically). */
const SERVER_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** Required fields, data binding, and description, derived from the island's Zod schema so they can never drift from it. */
function islandContract(type: IslandType): { type: IslandType; required: string[]; bindsData: boolean; description: string } {
  const schema = z.toJSONSchema(BUILTIN_ISLAND_SCHEMAS[type], { io: "input" }) as { required?: string[]; description: string };
  const required = (schema.required ?? []).filter((field) => field !== "type");
  return { type, required, bindsData: required.includes("dataset"), description: schema.description };
}

const LAYOUT_ROW_CONTRACT = {
  type: "layout.row",
  required: ["islands"],
  bindsData: false,
  description: (z.toJSONSchema(LayoutRow) as { description: string }).description,
};

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

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

function manifestDiff(base: string, proposed: string): string {
  if (base === proposed) return "(no changes)";
  return createTwoFilesPatch("app/manifest.json", "app/manifest.json", base, proposed);
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

export function createServer(projectRoot: string): McpServer {
  const manifestPath = join(projectRoot, "app", "manifest.json");
  const content = getContentStore(projectRoot);
  const appState = getAppStateStore(projectRoot);
  const proposals = createProposalStore(appState);
  const checkpoints = createCheckpointStore(projectRoot, appState, content);

  const readManifest = async (): Promise<string> => (await content.readText("app/manifest.json")) ?? "{}";

  /** Dry contract check: validate a proposed manifest and check islands against the live data. */
  async function dryCheck(proposedRaw: unknown): Promise<{ ok: boolean; errors: (IslandError | string)[]; custom: string[] }> {
    const v = validateManifest(proposedRaw);
    if (!v.ok || !v.manifest) return { ok: false, errors: v.errors, custom: [] };

    for (const [name, spec] of Object.entries(v.manifest.datasets)) {
      const ref = spec.sql ?? spec.source;
      if (!ref) continue;
      try {
        confineDatasetSource(projectRoot, ref);
      } catch (e) {
        return { ok: false, errors: [`dataset '${name}': ${(e as Error).message}`], custom: [] };
      }
    }

    // Resolve datasets against the PROPOSED manifest (a throwaway engine), not the on-disk one,
    // so a brand-new dataset/transform/markdown source can be bound and validated before it's
    // written — and a broken one reports the real DuckDB reason instead of a blanket "unreadable".
    const { columns, failures } = await inspectManifestDatasets(projectRoot, v.manifest);
    const columnsFor = async (dataset: string): Promise<Set<string> | null> => {
      const cols = columns.get(dataset);
      return cols ? new Set(cols.map((c) => c.name)) : null;
    };
    const { errors } = await checkManifestContracts(projectRoot, v.manifest, columnsFor);
    const queryErrors = await checkQueries(projectRoot, v.manifest, async (dataset) => columns.get(dataset) ?? null);
    const allErrors = [
      ...[...failures].map(([name, message]) => `dataset '${name}': ${message}`),
      ...errors,
      ...queryErrors.map((e) => `query '${e.query}': ${e.message}`),
    ];
    return { ok: allErrors.length === 0, errors: allErrors, custom: v.custom.map((c) => c.type) };
  }

  /** Serialize a proposed manifest, diff it against the base, dry-check it, and either return the
   * validation errors or save a staged proposal. The shared tail of propose_edit and patch_manifest. */
  async function stageProposal(base: string, manifest: unknown) {
    const proposed = JSON.stringify(manifest, null, 2) + "\n";
    const diff = manifestDiff(base, proposed);
    const check = await dryCheck(manifest);
    if (!check.ok) return { ok: false, errors: check.errors, diff };
    const stored: StoredProposal = { manifest: proposed, diff, baseHash: hashManifest(base) };
    return { ok: true, proposal_id: await proposals.save(stored), custom_islands: check.custom, diff };
  }

  const server = new McpServer({ name: "openislands", version: SERVER_VERSION });

  // --- read-only introspection ----------------------------------------------------

  server.registerTool(
    "list_islands",
    { description: "List the built-in island types with their required fields and a short description." },
    async () => json([...BUILTIN_ISLAND_TYPES.map(islandContract), LAYOUT_ROW_CONTRACT]),
  );

  server.registerTool(
    "get_island_schema",
    { description: "Get the JSON Schema for one island type — use it to ground an edit.", inputSchema: { type: z.string() } },
    async ({ type }) => {
      if (type === "layout.row") return json(z.toJSONSchema(LayoutRow));
      if (!BUILTIN_ISLAND_TYPES.includes(type as IslandType)) return text(`Unknown built-in island '${type}'. Known: ${BUILTIN_ISLAND_TYPES.join(", ")}, layout.row`);
      return json(jsonSchemaFor(type as IslandType));
    },
  );

  server.registerTool("get_manifest", { description: "Return the current app manifest." }, async () => text(await readManifest()));

  server.registerTool(
    "get_data_schema",
    { description: "Columns and inferred types for a dataset (from the live data).", inputSchema: { dataset: z.string() } },
    async ({ dataset }) => {
      resetEngine(projectRoot);
      try {
        const schema = await inferSchema(projectRoot, dataset);
        return json({ dataset, columns: schema.columns });
      } catch (e) {
        return text(`Can't read dataset '${dataset}': ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "query_data",
    {
      description: "Read rows live over your files (read-only, row-capped). Pass `dataset` for a whole dataset, or `sql` for a read-only SELECT over the registered dataset views.",
      inputSchema: {
        dataset: z.string().optional(),
        sql: z.string().optional().describe("a single read-only SELECT over the dataset views"),
        limit: z.number().int().positive().max(500).default(50),
      },
    },
    async ({ dataset, sql, limit }) => {
      if (dataset && sql) return text("Pass either `dataset` or `sql`, not both.");
      if (!dataset && !sql) return text("Pass a `dataset` name or a read-only `sql` SELECT.");
      resetEngine(projectRoot);
      try {
        const result = sql ? await queryRaw(projectRoot, sql, { limit }) : await query(projectRoot, dataset!, { limit });
        return json(result.rows);
      } catch (e) {
        return text(`Query failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "validate_manifest",
    {
      description: "Dry-run validate a manifest (a JSON object or string, or the current one if omitted) and check island bindings against the data.",
      inputSchema: { manifest: manifestArg.optional() },
    },
    async ({ manifest }) => {
      const parsed = manifest === undefined ? parseManifest(await readManifest()) : coerceManifest(manifest);
      if ("error" in parsed) return text(`Invalid JSON: ${parsed.error}`);
      return json(await dryCheck(parsed.raw));
    },
  );

  server.registerTool(
    "validate_sql",
    {
      description:
        "Dry-run a read-only SELECT against the registered dataset views WITHOUT running it for real — returns the result columns if valid, or the exact DuckDB error (catalog / parse / type) if not. Author a `sql` transform body here and confirm it binds before wiring it into a dataset, or sanity-check a query_data SELECT.",
      inputSchema: { sql: z.string().describe("a single read-only SELECT over the dataset views") },
    },
    async ({ sql }) => {
      resetEngine(projectRoot);
      return json(await validateSql(projectRoot, sql));
    },
  );

  server.registerTool(
    "list_checkpoints",
    { description: "List rollback checkpoints (prior manifests), newest last." },
    async () => json(await checkpoints.list()),
  );

  // --- the one write pipeline ------------------------------------------------------

  server.registerTool(
    "propose_edit",
    {
      description:
        "Propose a full manifest rewrite. Validates + checks data + returns a diff. Does NOT write — call apply_edit to commit. For adding/changing/removing individual datasets, actions, queries, connectors, or pages, prefer patch_manifest — it's incremental and far less error-prone than re-sending the whole manifest.",
      inputSchema: { manifest: manifestArg.describe("the full proposed manifest — pass a JSON object (preferred) or a JSON string") },
    },
    async ({ manifest }) => {
      const parsed = coerceManifest(manifest);
      if ("error" in parsed) return json({ ok: false, errors: [`Invalid JSON: ${parsed.error}`] });
      return json(await stageProposal(await readManifest(), parsed.raw));
    },
  );

  server.registerTool(
    "patch_manifest",
    {
      description:
        "Incrementally edit the manifest by section — the preferred editor. Add, replace, or remove individual datasets, actions, queries, connectors, and pages WITHOUT re-sending the whole manifest. Record sections take a map of name → spec (or name → null to delete). Pages take full Page objects (upserted by id); remove_pages deletes by id. To change one island, send just its page in `pages`. The patch is merged into the current manifest, validated, checked against the data, and returned as a diff + proposal_id — nothing is written until apply_edit. Same safety pipeline as propose_edit, far less to get wrong.",
      inputSchema: {
        title: z.string().optional(),
        icon: z.string().optional().describe("workspace tile icon"),
        datasets: z.record(z.string(), DatasetSpec.nullable()).optional().describe("name → dataset spec; name → null deletes it"),
        actions: z.record(z.string(), ActionSpec.nullable()).optional().describe("name → action spec; name → null deletes it"),
        queries: z.record(z.string(), QuerySpec.nullable()).optional().describe("name → query spec; name → null deletes it"),
        connectors: z.record(z.string(), ConnectorSpec.nullable()).optional().describe("name → connector spec; name → null deletes it"),
        pages: z.array(Page).optional().describe("full Page objects, upserted by id (a matching id is replaced, a new id is appended)"),
        remove_pages: z.array(z.string()).optional().describe("page ids to remove"),
      },
    },
    async (patch) => {
      const base = await readManifest();
      let current: Record<string, unknown>;
      try {
        current = JSON.parse(base) as Record<string, unknown>;
      } catch {
        current = {};
      }
      return json(await stageProposal(base, applyManifestPatch(current, patch as Record<string, unknown>)));
    },
  );

  server.registerTool(
    "apply_edit",
    { description: "Write a previously-proposed edit (from propose_edit or patch_manifest). Rejects stale/unknown proposals. Snapshots the current manifest first for rollback.", inputSchema: { proposal_id: z.string() } },
    async ({ proposal_id }) => {
      const proposal = await proposals.load(proposal_id);
      if (!proposal) return json({ ok: false, error: `Unknown proposal '${proposal_id}'. Call propose_edit first.` });

      const base = await readManifest();
      if (hashManifest(base) !== proposal.baseHash) {
        await proposals.remove(proposal_id);
        return json({ ok: false, error: "stale proposal: the manifest changed since this edit was proposed. Re-run propose_edit." });
      }

      const checkpoint = (await content.exists("app/manifest.json")) ? await checkpoints.snapshotManifest(base) : null;
      await content.writeText("app/manifest.json", proposal.manifest);
      await proposals.remove(proposal_id);

      return json({ ok: true, checkpoint_id: checkpoint, applied: manifestPath });
    },
  );

  server.registerTool(
    "rollback",
    { description: "Restore a prior checkpoint byte-for-byte — a manifest edit or a data-action append (latest if none given).", inputSchema: { checkpoint_id: z.string().optional() } },
    async ({ checkpoint_id }) => {
      const available = await checkpoints.list();
      if (available.length === 0) return json({ ok: false, error: "no history yet", available });
      if (checkpoint_id && !isCheckpointId(checkpoint_id)) return json({ ok: false, error: "invalid checkpoint id", available });
      const target = checkpoint_id ?? available.at(-1)!;
      if (!available.includes(target)) return json({ ok: false, error: "checkpoint not found", available });

      const { restoredData } = await checkpoints.restore(target);
      if (restoredData) resetEngine(projectRoot);
      return json({ ok: true, restored: target });
    },
  );

  // --- data actions: typed appends into declared datasets --------------------------

  server.registerTool(
    "list_actions",
    { description: "List the manifest's declared data actions with their resolved row JSON Schema — the agent's grounding for run_action." },
    async () => {
      const manifest = await readProjectManifest(projectRoot);
      const actions = manifest.actions ?? {};
      resetEngine(projectRoot);
      const out = [];
      for (const [name, spec] of Object.entries(actions)) {
        out.push({
          name,
          dataset: spec.dataset,
          mode: spec.mode,
          description: spec.description,
          rowSchema: z.toJSONSchema(await actionRowSchema(projectRoot, name)),
        });
      }
      return json(out);
    },
  );

  server.registerTool(
    "run_action",
    {
      description: "Append typed rows through a declared action. Validates every row against the action schema (all-or-nothing); on success snapshots the file and returns a rollback checkpoint_id.",
      inputSchema: { name: z.string(), rows: z.array(z.record(z.string(), z.unknown())) },
    },
    async ({ name, rows }) => {
      const manifest = await readProjectManifest(projectRoot);
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
        confineDatasetSource(projectRoot, dataset.source);
      } catch (e) {
        return json({ ok: false, error: (e as Error).message });
      }

      try {
        const result = await insertRows(projectRoot, name, rows);
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
    { description: "List the manifest's declared read queries with their params JSON Schema and result columns — the agent's grounding for run_query." },
    async () => {
      const manifest = await readProjectManifest(projectRoot);
      const queries = manifest.queries ?? {};
      resetEngine(projectRoot);
      const out = [];
      for (const [name, spec] of Object.entries(queries)) {
        let params: unknown = {};
        let columns: unknown[] = [];
        try {
          params = z.toJSONSchema(await queryParamSchema(projectRoot, name));
        } catch {
          /* surfaced by validate */
        }
        try {
          columns = await queryColumns(projectRoot, name);
        } catch {
          /* surfaced by validate */
        }
        out.push({ name, description: spec.description, params, columns });
      }
      return json(out);
    },
  );

  server.registerTool(
    "run_query",
    {
      description: "Run a declared read-only query with typed params. Validates params first (all-or-nothing); returns rows. Read-only and row-capped — never writes.",
      inputSchema: {
        name: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    async ({ name, params, limit }) => {
      const manifest = await readProjectManifest(projectRoot);
      const spec = manifest.queries?.[name];
      if (!spec) {
        const declared = Object.keys(manifest.queries ?? {});
        return json({ ok: false, error: `unknown query '${name}'. Declared: ${declared.length ? declared.join(", ") : "(none)"}` });
      }
      resetEngine(projectRoot);
      try {
        const result = await runQuery(projectRoot, name, params ?? {}, { limit: limit ?? 100 });
        return json({ ok: true, rowCount: result.rows.length, columns: result.columns, rows: result.rows });
      } catch (e) {
        if (e instanceof QueryValidationError) return json({ ok: false, errors: e.errors });
        return json({ ok: false, error: (e as Error).message });
      }
    },
  );

  // --- connectors: discover + pull data from external providers --------------------

  server.registerTool(
    "list_connectors",
    {
      description:
        "List the manifest's declared connectors with their live status: auth kind, whether they're connected, any missing secrets, schedule, last sync/error. This is how you discover that a connector needs authorizing — authorizing it is human-only (the Connect button in the dashboard / `openislands serve`), so when `connected` is false surface that to the user rather than trying to sync.",
    },
    async () => json(await listConnectorStatuses(projectRoot)),
  );

  server.registerTool(
    "run_sync",
    {
      description:
        "Run one connector sync now: pulls from the provider and writes rows into its `source` datasets through the checkpointed write path (covered by rollback). Returns per-dataset rows/mode/checkpoint. Fails if the connector isn't connected — check list_connectors first.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      try {
        return json(await runConnectorSync(projectRoot, name));
      } catch (e) {
        return json({ ok: false, error: (e as Error).message });
      }
    },
  );

  return server;
}
