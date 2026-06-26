/**
 * @openislands/mcp — the MCP server factory. This is the safety boundary that lets an AI agent
 * *maintain* a dashboard without it rotting.
 *
 * Code Mode surface: instead of a tool per operation (which bloats the model's context and forces a
 * round-trip per step), the agent writes a small JavaScript program against the `oi` API and runs it
 * through ONE tool — `execute` — composing many steps in a single call. The whole API lives in
 * {@link createAppApi} (api.ts) and runs in a node:vm (codemode.ts); that one tool is the entire
 * surface (plus two read-only resources for the app catalog + per-app manifests).
 *
 * Read-many / write-one still holds: there is no raw filesystem write; every manifest change funnels
 * through patchManifest/replaceManifest → validate + data-check → a staged proposal → applyEdit,
 * which snapshots the prior state for rollback.
 */
import { mkdir, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAppStateStore, getContentStore } from "@openislands/storage";
import { type AppContext, type ApiRuntime, createAppApi, minimalManifest } from "./api.js";
import { createCheckpointStore } from "./checkpoints.js";
import { runCode } from "./codemode.js";
import { createProposalStore } from "./proposals.js";
import { isSafeAppId, scanWorkspaceApps as scanApps } from "@openislands/compiler";

/** Read from package.json so the MCP handshake version tracks the published release. */
const SERVER_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** Code Mode execution limits. The timeout is advisory for async work (it stops the API from
 * starting NEW operations and races the result; an in-flight write still lands — checkpointed). */
const CODEMODE_TIMEOUT_MS = 30_000;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (v: Record<string, unknown>) => text(JSON.stringify(v, null, 2));

/**
 * Server-level usage guidance, surfaced to the model at connect time (MCP `instructions`). The one
 * place the loop reaches a *generic* MCP client — the richer SKILL.md / AGENTS.md only ship to Claude
 * Code. Keep it tight; it's always in context.
 */
const INSTRUCTIONS = `OpenIslands maintains a typed dashboard ("manifest") of visual islands bound to local data files.

Code Mode: this server exposes ONE tool — execute — that executes a small async JavaScript program against the \`oi\` API. Read execute's description for the full API (TypeScript). Compose as many steps as you need in one script (loops, conditionals, chaining); \`return\` a value and/or \`console.log\`. Start by orienting: \`const ov = await oi.app().getOverview();\` returns the manifest, every dataset's live columns, and the declared actions/queries/connectors.

Read freely, but write one way: every manifest change funnels through a staged proposal (oi.app().patchManifest/replaceManifest → applyEdit) — there is no raw file write, and applyEdit snapshots the prior state so rollback can undo it. If a stage returns ok:false, each error names the page/island/field — fix it and retry; never work around it.

Multiple apps: oi.app(id) selects one (omit id when there's exactly one); oi.listApps() lists them. Connectors authorize human-only (the Connect button in the dashboard) — if one isn't connected, tell the user; don't try to sync.`;

/** The `oi` TypeScript API, embedded so the model programs against types instead of tool schemas.
 * Keep in sync with {@link AppApi} in api.ts (the tool-surface test asserts method-name parity). */
const OI_API_DECL = `type Verbosity = "concise" | "detailed";

declare const oi: {
  // workspace
  listApps(): Promise<{ ok: boolean; apps: { id: string; title: string; dir: string }[] }>;
  createApp(input: { id: string; title?: string }): Promise<{ ok: boolean; id?: string; dir?: string; error?: string }>;
  deleteApp(input: { id: string }): Promise<{ ok: boolean; archivedTo?: string; error?: string }>;
  // app-scoped API; omit \`id\` when the workspace has exactly one app, else pass it (see oi.listApps()).
  app(id?: string): AppApi;
};

interface AppApi {
  // orient
  getOverview(opts?: { verbosity?: Verbosity }): Promise<Overview>;        // START HERE: manifest + every dataset's live columns + actions/queries/connectors + checkpoint count
  getManifest(): Promise<Manifest>;                                        // the raw manifest object
  listIslands(): Promise<{ ok; islands }>;                                 // built-in island types + required fields + span range
  getIslandSchema(type: string): Promise<{ ok; schema; layout; notes }>;   // JSON Schema + layout guidance for one island type (e.g. "metric.kpi", or "layout.row")
  getDataSchema(dataset: string): Promise<{ ok; dataset; columns }>;       // columns + inferred types from the live data
  // read data (read-only, row-capped; pass verbosity:"detailed" for a bigger pull)
  runSql(input: { sql?: string; dataset?: string; limit?: number; verbosity?: Verbosity }): Promise<{ ok; rows; rowCount; truncated? }>;  // one read-only SELECT over the dataset views, or a whole dataset
  validateSql(sql: string): Promise<{ ok; columns?; error? }>;            // dry-run a SELECT (catalog/parse/type errors) without running it
  validateManifest(manifest?: Manifest): Promise<{ ok; errors; warnings }>; // validate + check bindings vs data (current manifest if omitted)
  // edit the manifest — read-many / write-one. Nothing is written until applyEdit.
  patchManifest(patch: ManifestPatch): Promise<Proposal>;                 // PREFERRED: send only the sections that change
  replaceManifest(manifest: Manifest): Promise<Proposal>;                 // full rewrite
  applyEdit(proposalId: string): Promise<{ ok; checkpoint_id? }>;         // write a staged proposal; snapshots prior state for rollback
  rollback(checkpointId?: string): Promise<{ ok; restored? }>;           // restore a checkpoint byte-for-byte (latest if omitted)
  listCheckpoints(): Promise<{ ok; checkpoints: string[] }>;
  pruneCheckpoints(keep?: number): Promise<{ ok; kept; removed }>;
  // data actions (typed appends) + queries (typed reads)
  listActions(): Promise<{ ok; actions }>;
  runActions(calls: { action: string; rows: object[] }[], opts?: { atomic?: boolean }): Promise<{ ok; results?; checkpoint_ids?; failures? }>;  // typed appends; atomic by default: validates all calls first, rolls back every write if any fails. Single insert = runActions([{ action, rows }])
  listQueries(): Promise<{ ok; queries }>;
  runQuery(name: string, params?: object, opts?: { limit?: number; verbosity?: Verbosity }): Promise<{ ok; rows; columns }>;
  // connectors — provider sync (authorizing is human-only via the dashboard Connect button)
  listConnectors(): Promise<{ ok; connectors }>;
  runSync(name: string): Promise<{ ok; error? }>;
}

// Proposal: { ok; proposal_id?; diff; warnings?; errors? }   — errors name the page/island/field on ok:false
// ManifestPatch: { title?; icon?; datasets?: Record<name, spec|null>; actions?; queries?; connectors?; pages?: Page[]; remove_pages?: string[] }   // null deletes a key; pages upsert by id`;

const EXECUTE_DESCRIPTION = `Run the OpenIslands API by writing a small async JavaScript program (Code Mode). One tool replaces the per-operation tools: write JS that calls the \`oi\` API, compose many steps in a single call (loops, conditionals, chaining), and \`return\` a value and/or \`console.log\` what you want back. It runs in a sandbox — no require / process / network, only \`oi\`. The result is { ok, result, logs, checkpoints_created? }; on a thrown error it's { ok:false, error, logs }.

Read-many / write-one: read freely; every manifest change goes stage → apply (oi.app().patchManifest/replaceManifest returns a proposal_id, then oi.app().applyEdit(proposal_id) writes it and snapshots the prior state for rollback). If a stage returns ok:false, each error names the page/island/field — fix it and retry.

${OI_API_DECL}

Example — orient, add a KPI, apply:
  const app = oi.app();
  const ov = await app.getOverview();
  const page = ov.pages[0];
  page.islands.push({ type: "metric.kpi", title: "Net worth", dataset: "net_worth_monthly", value: "net_worth_eur", format: "eur", span: 4 });
  const staged = await app.patchManifest({ pages: [page] });
  if (!staged.ok) return staged.errors;             // each error names the page/island/field
  return await app.applyEdit(staged.proposal_id);

Example — sanity-check every dataset in one call:
  const app = oi.app();
  const ov = await app.getOverview();
  const counts = {};
  for (const name of Object.keys(ov.datasets)) counts[name] = (await app.runSql({ dataset: name, limit: 1 })).rowCount;
  return counts;`;

/** Returned by resolveApp on failure — surfaced as `{ ok:false, error }` instead of throwing. */
interface AppResolutionError {
  error: string;
}
const isResolutionError = (r: AppContext | AppResolutionError): r is AppResolutionError => "error" in r;

const readManifestText = async (ctx: AppContext): Promise<string> => (await ctx.content.readText("manifest.json")) ?? "{}";

/** Best-effort manifest title for the apps list + resource list — falls back to the id. */
async function appTitle(ctx: AppContext): Promise<string> {
  try {
    const parsed = JSON.parse(await readManifestText(ctx)) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : ctx.id;
  } catch {
    return ctx.id;
  }
}

export function createServer(projectRoot: string): McpServer {
  const contexts = new Map<string, AppContext>();

  /** Build (once) the per-app context for `id`, rooted at `<root>/apps/<id>`. Memoized so the storage
   * ports + stores are stable for the life of the session. */
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

  /** Resolve the optional `app` selector to a per-app context. Explicit ids are validated + must
   * exist; an omitted id resolves to the sole app, else errors and names the candidates. */
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

  // --- workspace operations: shared by oi + the atomic create/delete tools ----------

  async function listApps(): Promise<Record<string, unknown>> {
    const out = [];
    for (const { id, dir } of scanApps(projectRoot)) out.push({ id, title: await appTitle(appCtx(id)), dir });
    return { ok: true, apps: out };
  }

  async function createApp({ id, title }: { id: string; title?: string }): Promise<Record<string, unknown>> {
    if (!isSafeAppId(id)) return { ok: false, error: `invalid app id '${id}' — use one safe path segment (letters, digits, '.', '_', '-')` };
    const dir = join(projectRoot, "apps", id);
    if (existsSync(dir)) return { ok: false, error: `app '${id}' already exists` };
    for (const sub of ["data", "models", "docs"]) await mkdir(join(dir, sub), { recursive: true });
    await getContentStore(dir).writeText("manifest.json", minimalManifest(title ?? id));
    contexts.delete(id);
    return { ok: true, id, dir };
  }

  async function deleteApp({ id }: { id: string }): Promise<Record<string, unknown>> {
    if (!isSafeAppId(id)) return { ok: false, error: `invalid app id '${id}'` };
    const dir = join(projectRoot, "apps", id);
    if (!existsSync(dir)) return { ok: false, error: `unknown app '${id}'` };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const trashDir = join(projectRoot, ".openislands", "trash");
    const archivedTo = join(trashDir, `${id}-${stamp}`);
    await mkdir(trashDir, { recursive: true });
    await rename(dir, archivedTo);
    contexts.delete(id);
    return { ok: true, archivedTo };
  }

  /** Build the `oi` object handed to a Code Mode script. App-scoped APIs are memoized per id for the
   * script's life so the engine dirty-bit + checkpoint sink are shared across calls to the same app. */
  function buildOi(runtime: ApiRuntime) {
    const apis = new Map<string, ReturnType<typeof createAppApi>>();
    return {
      listApps,
      createApp,
      deleteApp,
      app(id?: string) {
        const ctx = resolveApp(id);
        if (isResolutionError(ctx)) throw new Error(ctx.error);
        const cached = apis.get(ctx.id);
        if (cached) return cached;
        const api = createAppApi(ctx, runtime);
        apis.set(ctx.id, api);
        return api;
      },
    };
  }

  const server = new McpServer({ name: "openislands", version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  // --- the Code Mode tool ----------------------------------------------------------

  server.registerTool(
    "execute",
    {
      description: EXECUTE_DESCRIPTION,
      inputSchema: { code: z.string().describe("an async JavaScript program calling the `oi` API; return a value and/or console.log") },
      annotations: { title: "Run code", readOnlyHint: false, openWorldHint: true },
    },
    async ({ code }) => {
      const checkpoints: string[] = [];
      const controller = new AbortController();
      // Abort at the deadline so the API stops starting NEW operations (the run also races a timeout).
      const abortTimer = setTimeout(() => controller.abort(), CODEMODE_TIMEOUT_MS);
      try {
        const oi = buildOi({ signal: controller.signal, onCheckpoint: (id) => checkpoints.push(id) });
        const result = await runCode({ code, globals: { oi }, timeoutMs: CODEMODE_TIMEOUT_MS });
        return json({ ...result, ...(checkpoints.length ? { checkpoints_created: checkpoints } : {}) });
      } finally {
        clearTimeout(abortTimer);
      }
    },
  );

  // --- resources: the app catalog + per-app manifests ------------------------------

  server.registerResource(
    "apps",
    "openislands://apps",
    { title: "Apps", description: "The workspace's apps (id + title).", mimeType: "application/json" },
    async (uri) => {
      const list = [];
      for (const { id } of scanApps(projectRoot)) list.push({ id, title: await appTitle(appCtx(id)) });
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
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: await readManifestText(appCtx(appId)) }] };
    },
  );

  return server;
}
