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
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { ActionValidationError, actionRowSchema, insertRows, checkManifestContracts, inferSchema, listConnectorStatuses, query, queryRaw, readManifest as readProjectManifest, resetEngine, runConnectorSync } from "@openislands/compiler";
import { BUILTIN_ISLAND_SCHEMAS, BUILTIN_ISLAND_TYPES, LayoutRow, jsonSchemaFor, validateManifest, type IslandError, type IslandType } from "@openislands/schema";
import { getAppStateStore, getContentStore } from "@openislands/storage";
import { createCheckpointStore, isCheckpointId } from "./checkpoints.js";
import { confineDatasetSource } from "./paths.js";
import { createProposalStore, hashManifest, type StoredProposal } from "./proposals.js";

const MAX_ROWS_PER_ACTION = 100;

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

function manifestDiff(base: string, proposed: string): string {
  if (base === proposed) return "(no changes)";
  return createTwoFilesPatch("app/manifest.json", "app/manifest.json", base, proposed);
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

    resetEngine(projectRoot);
    const columnsByDataset = new Map<string, Set<string> | null>();
    const columnsFor = async (dataset: string): Promise<Set<string> | null> => {
      if (!columnsByDataset.has(dataset)) {
        const columns = await inferSchema(projectRoot, dataset)
          .then((schema) => new Set(schema.columns.map((c) => c.name)))
          .catch(() => null);
        columnsByDataset.set(dataset, columns);
      }
      return columnsByDataset.get(dataset)!;
    };
    const { errors } = await checkManifestContracts(projectRoot, v.manifest, columnsFor);
    return { ok: errors.length === 0, errors, custom: v.custom.map((c) => c.type) };
  }

  const server = new McpServer({ name: "openislands", version: "0.1.0" });

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
    { description: "Dry-run validate a manifest (or the current one) and check island bindings against the data.", inputSchema: { manifest: z.string().optional() } },
    async ({ manifest }) => {
      const parsed = parseManifest(manifest ?? (await readManifest()));
      if ("error" in parsed) return text(`Invalid JSON: ${parsed.error}`);
      return json(await dryCheck(parsed.raw));
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
      description: "Propose a new full manifest. Validates + checks data + returns a diff. Does NOT write — call apply_edit to commit.",
      inputSchema: { manifest: z.string().describe("the full proposed manifest as JSON") },
    },
    async ({ manifest }) => {
      const parsed = parseManifest(manifest);
      if ("error" in parsed) return json({ ok: false, errors: [`Invalid JSON: ${parsed.error}`] });
      const base = await readManifest();
      const proposed = JSON.stringify(parsed.raw, null, 2) + "\n";
      const diff = manifestDiff(base, proposed);
      const check = await dryCheck(parsed.raw);
      if (!check.ok) return json({ ok: false, errors: check.errors, diff });

      const stored: StoredProposal = { manifest: proposed, diff, baseHash: hashManifest(base) };
      return json({ ok: true, proposal_id: await proposals.save(stored), custom_islands: check.custom, diff });
    },
  );

  server.registerTool(
    "apply_edit",
    { description: "Write a previously-proposed edit. Rejects stale/unknown proposals. Snapshots the current manifest first for rollback.", inputSchema: { proposal_id: z.string() } },
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
