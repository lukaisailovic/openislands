/**
 * Behavioral coverage for @openislands/mcp's edit pipeline, reads, actions, queries, connectors,
 * and validation — the deep single-app suite.
 *
 * Code Mode moved EVERY operation off the tool surface and onto the `oi` API inside the single
 * execute tool. Rather than rewrite ~120 scripted steps, `call` is now a thin dispatcher: each
 * former tool name is compiled to the equivalent `oi.app().<method>(...)` program and run through
 * execute, returning that method's envelope verbatim (each `oi` method returns the same `{ ok, … }`
 * object the old tool did). So the test bodies below read exactly as the agent's intent — only the
 * transport underneath them changed.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resetCustomSchemaCache } from "@openislands/compiler";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { resetEngine } from "@openislands/compiler";
import { createServer } from "../src/server.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "finance");
const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) resetEngine(dir);
});

/** The workspace root that owns an app dir laid out as `<workspace>/apps/<id>`. */
const workspaceOf = (appDir: string): string => dirname(dirname(appDir));

/** A single-app workspace. The fixture's `app/` + `data/` live at `<workspace>/apps/finance/`,
 * and the returned value is that APP dir — every path helper joins against it, and `connect`
 * derives the workspace root from it. With one app, every tool resolves it without an `app` arg. */
function freshProject(): string {
  const workspace = mkdtempSync(join(tmpdir(), "oi-mcp-"));
  const appDir = join(workspace, "apps", "finance");
  cpSync(FIXTURE, appDir, { recursive: true });
  roots.push(appDir);
  return appDir;
}

/** Connect a client to the workspace that owns `appDir`. */
async function connect(appDir: string): Promise<Client> {
  const server = createServer(workspaceOf(appDir));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return client;
}

/** Invoke a tool (only execute exists now) and parse its JSON envelope. */
async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[] };
  const body = res.content[0]!.text;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** Compile a former tool name + its flat args into the `oi.app().<method>(...)` call expression.
 * Each entry returns the JS argument list (the args are JSON-encoded by the caller). Since the
 * pivot to pure Code Mode, even get_overview / apply_edit / rollback are `oi` methods. */
const OI_METHOD: Record<string, { method: string; args: (a: Record<string, unknown>) => unknown[] }> = {
  get_overview: { method: "getOverview", args: (a) => ("verbosity" in a ? [{ verbosity: a.verbosity }] : []) },
  get_data_schema: { method: "getDataSchema", args: (a) => [a.dataset] },
  get_island_schema: { method: "getIslandSchema", args: (a) => [a.type] },
  list_islands: { method: "listIslands", args: () => [] },
  run_sql: { method: "runSql", args: (a) => [a] },
  validate_sql: { method: "validateSql", args: (a) => [a.sql] },
  validate_manifest: { method: "validateManifest", args: (a) => ("manifest" in a ? [a.manifest] : []) },
  list_checkpoints: { method: "listCheckpoints", args: () => [] },
  prune_checkpoints: { method: "pruneCheckpoints", args: (a) => ("keep" in a ? [a.keep] : []) },
  replace_manifest: { method: "replaceManifest", args: (a) => [a.manifest] },
  patch_manifest: { method: "patchManifest", args: (a) => [a] },
  apply_edit: { method: "applyEdit", args: (a) => [a.proposal_id] },
  rollback: { method: "rollback", args: (a) => ("checkpoint_id" in a ? [a.checkpoint_id] : []) },
  list_actions: { method: "listActions", args: () => [] },
  list_queries: { method: "listQueries", args: () => [] },
  run_query: { method: "runQuery", args: (a) => [a.name, a.params ?? {}, { limit: a.limit, verbosity: a.verbosity }] },
  list_connectors: { method: "listConnectors", args: () => [] },
  run_sync: { method: "runSync", args: (a) => [a.name] },
};

/** Compile a `run_action` call into a single-call `runActions` program that projects the batch
 * result back to the legacy singular envelope ({ ok, inserted?, checkpoint_id?, errors?, error? }),
 * so the single-insert tests below read unchanged while exercising the only insert method. */
function runActionProjection(args: Record<string, unknown>): string {
  const call = JSON.stringify({ action: args.name, rows: args.rows });
  return `
    const out = await oi.app().runActions([${call}]);
    if (out.ok) { const r = out.results[0]; return { ok: true, inserted: r.inserted, checkpoint_id: r.checkpoint_id }; }
    const f = out.failures[0];
    return f.errors ? { ok: false, errors: f.errors } : { ok: false, error: f.error };
  `;
}

/**
 * Drive a former tool by compiling it to an `oi.app().<method>(...)` program, running it through
 * the single execute tool, and returning that method's envelope verbatim — so each call site reads
 * unchanged. (A thrown checkpoint id still rides inside the method's own result envelope.)
 */
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  let code: string;
  if (name === "run_action") {
    code = runActionProjection(args);
  } else {
    const spec = OI_METHOD[name];
    if (!spec) throw new Error(`no Code Mode mapping for former tool '${name}'`);
    const argList = spec.args(args).map((a) => JSON.stringify(a)).join(", ");
    code = `return await oi.app().${spec.method}(${argList});`;
  }
  const out = (await callTool(client, "execute", { code })) as { ok: boolean; result?: unknown; error?: string };
  if (!out.ok) throw new Error(`execute failed for ${name}: ${out.error}`);
  return out.result;
}

/** Run an explicit `oi` program and return its `result`. Used by the few tests whose method result
 * is too big to round-trip whole through execute's response cap (e.g. layout.row's schema, which
 * embeds the island catalog) — the program returns only the fields the test asserts, exactly as an
 * agent would project a large result down before returning it. */
async function runResult<T>(client: Client, code: string): Promise<T> {
  const out = (await callTool(client, "execute", { code })) as { ok: boolean; result: T; error?: string };
  expect(out.ok, out.error).toBe(true);
  return out.result;
}

const validManifest = (root: string) => readFileSync(join(root, "manifest.json"), "utf8");

describe("read tools", () => {
  it("list_islands returns contracts with required fields", async () => {
    const client = await connect(freshProject());
    const { islands } = (await call(client, "list_islands")) as { islands: { type: string; required: string[] }[] };
    const kpi = islands.find((i) => i.type === "metric.kpi");
    expect(kpi?.required).toEqual(["dataset", "value"]);
    const note = islands.find((i) => i.type === "note.card");
    expect(note?.required).toEqual(["markdown"]);
  });

  it("run_sql reads a dataset", async () => {
    const client = await connect(freshProject());
    const { rows } = (await call(client, "run_sql", { dataset: "net_worth_monthly", limit: 2 })) as { rows: unknown[] };
    expect(rows.length).toBe(2);
  });

  it("run_sql runs a read-only SQL SELECT over the views", async () => {
    const client = await connect(freshProject());
    const { rows } = (await call(client, "run_sql", { sql: "SELECT class, value_eur FROM allocation ORDER BY value_eur DESC", limit: 1 })) as { rows: { class: string }[] };
    expect(rows[0]!.class).toBe("BTC");
  });

  it("run_sql rejects non-SELECT SQL", async () => {
    const client = await connect(freshProject());
    const out = (await call(client, "run_sql", { sql: "DROP TABLE allocation" })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/read-only|failed/i);
  });
});

describe("get_overview — one-call orientation", () => {
  it("returns the manifest, dataset columns, actions, queries, connectors and checkpoint state in one call", async () => {
    const client = await connect(freshProject());
    const ov = (await call(client, "get_overview")) as {
      ok: boolean;
      title: string;
      datasets: Record<string, { source: string | null; columns: { name: string }[] | null; error: string | null }>;
      actions: { name: string; dataset: string; mode: string }[];
      queries: unknown[];
      connectors: unknown[];
      pages: { id: string }[];
      checkpoints: { count: number; latest: string | null };
    };
    expect(ov.ok).toBe(true);
    expect(ov.title).toBe("Finance Overview");
    expect(Object.keys(ov.datasets).toSorted()).toEqual(["allocation", "net_worth_monthly", "notes"]);
    expect(ov.datasets.allocation!.columns!.map((c) => c.name).toSorted()).toEqual(["class", "value_eur"]);
    expect(ov.datasets.allocation!.error).toBeNull();
    expect(ov.actions).toHaveLength(1);
    expect(ov.actions[0]!.name).toBe("log_allocation");
    expect(ov.queries).toEqual([]);
    expect(ov.connectors).toEqual([]);
    expect(ov.pages.map((p) => p.id)).toEqual(["overview"]);
    expect(ov.checkpoints).toEqual({ count: 0, latest: null });
  });

  it("reflects a checkpoint after an apply_edit", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.title = "Edited";
    const proposed = (await call(client, "replace_manifest", { manifest: next })) as { proposal_id: string };
    await call(client, "apply_edit", { proposal_id: proposed.proposal_id });
    const ov = (await call(client, "get_overview")) as { title: string; checkpoints: { count: number; latest: string | null } };
    expect(ov.title).toBe("Edited");
    expect(ov.checkpoints.count).toBe(1);
    expect(ov.checkpoints.latest).toMatch(/^ckpt-\d+$/);
  });

  it("still orients on a structurally-invalid manifest (ok:false with errors)", async () => {
    const root = freshProject();
    const m = JSON.parse(validManifest(root));
    m.version = "not-a-number";
    writeFileSync(join(root, "manifest.json"), JSON.stringify(m));
    const client = await connect(root);
    const ov = (await call(client, "get_overview")) as { ok: boolean; errors: unknown[]; checkpoints: { count: number } };
    expect(ov.ok).toBe(false);
    expect(ov.errors.length).toBeGreaterThan(0);
    expect(ov.checkpoints.count).toBe(0);
  });
});

describe("edit pipeline state machine", () => {
  it("propose → apply writes the manifest", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.title = "Edited";
    const proposed = (await call(client, "replace_manifest", { manifest: JSON.stringify(next) })) as { ok: boolean; proposal_id: string };
    expect(proposed.ok).toBe(true);
    const applied = (await call(client, "apply_edit", { proposal_id: proposed.proposal_id })) as { ok: boolean };
    expect(applied.ok).toBe(true);
    expect(JSON.parse(validManifest(root)).title).toBe("Edited");
  });

  it("propose invalid → reject → re-propose valid → apply", async () => {
    const root = freshProject();
    const client = await connect(root);
    const bad = JSON.parse(validManifest(root));
    bad.pages[0].islands[0].value = "does_not_exist";
    const rejected = (await call(client, "replace_manifest", { manifest: JSON.stringify(bad) })) as { ok: boolean; errors: unknown[] };
    expect(rejected.ok).toBe(false);
    expect(rejected.errors.length).toBeGreaterThan(0);

    const good = JSON.parse(validManifest(root));
    good.title = "Fixed";
    const ok = (await call(client, "replace_manifest", { manifest: JSON.stringify(good) })) as { ok: boolean; proposal_id: string };
    expect(ok.ok).toBe(true);
    const applied = (await call(client, "apply_edit", { proposal_id: ok.proposal_id })) as { ok: boolean };
    expect(applied.ok).toBe(true);
  });

  it("apply → rollback restores byte-for-byte", async () => {
    const root = freshProject();
    const client = await connect(root);
    const original = validManifest(root);
    const next = JSON.parse(original);
    next.title = "Changed";
    const proposed = (await call(client, "replace_manifest", { manifest: JSON.stringify(next) })) as { proposal_id: string };
    await call(client, "apply_edit", { proposal_id: proposed.proposal_id });
    expect(validManifest(root)).not.toBe(original);

    const back = (await call(client, "rollback")) as { ok: boolean };
    expect(back.ok).toBe(true);
    expect(validManifest(root)).toBe(original);
  });

  it("double-apply of the same proposal is rejected", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.title = "Once";
    const proposed = (await call(client, "replace_manifest", { manifest: JSON.stringify(next) })) as { proposal_id: string };
    const first = (await call(client, "apply_edit", { proposal_id: proposed.proposal_id })) as { ok: boolean };
    expect(first.ok).toBe(true);
    const second = (await call(client, "apply_edit", { proposal_id: proposed.proposal_id })) as { ok: boolean; error: string };
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/unknown/i);
  });

  it("apply of an unknown id is rejected", async () => {
    const client = await connect(freshProject());
    const out = (await call(client, "apply_edit", { proposal_id: "prop-deadbeefdeadbeef" })) as { ok: boolean };
    expect(out.ok).toBe(false);
  });

  it("apply of a stale proposal (base manifest changed) is rejected", async () => {
    const root = freshProject();
    const client = await connect(root);
    const a = JSON.parse(validManifest(root));
    a.title = "A";
    const propA = (await call(client, "replace_manifest", { manifest: JSON.stringify(a) })) as { proposal_id: string };

    const b = JSON.parse(validManifest(root));
    b.title = "B";
    const propB = (await call(client, "replace_manifest", { manifest: JSON.stringify(b) })) as { proposal_id: string };
    await call(client, "apply_edit", { proposal_id: propB.proposal_id });

    const stale = (await call(client, "apply_edit", { proposal_id: propA.proposal_id })) as { ok: boolean; error: string };
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/stale/i);
  });

  it("a restarted server applies a persisted proposal and lists checkpoints", async () => {
    const root = freshProject();
    const client1 = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.title = "Persisted";
    const proposed = (await call(client1, "replace_manifest", { manifest: JSON.stringify(next) })) as { proposal_id: string };

    const client2 = await connect(root);
    const applied = (await call(client2, "apply_edit", { proposal_id: proposed.proposal_id })) as { ok: boolean };
    expect(applied.ok).toBe(true);
    const { checkpoints } = (await call(client2, "list_checkpoints")) as { checkpoints: string[] };
    expect(checkpoints.length).toBe(1);
  });
});

describe("grouped manifests", () => {
  function regroup(root: string): Record<string, unknown> {
    const m = JSON.parse(validManifest(root));
    const islands = m.pages[0].islands;
    delete m.pages[0].islands;
    m.pages[0].icon = "wallet";
    m.pages[0].groups = [
      { id: "headline", title: "Headline", islands: islands.slice(0, 1) },
      { id: "rest", title: "Rest", islands: islands.slice(1) },
    ];
    return m;
  }

  it("propose → apply writes a valid grouped manifest", async () => {
    const root = freshProject();
    const client = await connect(root);
    const grouped = regroup(root);
    const proposed = (await call(client, "replace_manifest", { manifest: JSON.stringify(grouped) })) as { ok: boolean; proposal_id: string };
    expect(proposed.ok).toBe(true);
    expect(proposed.proposal_id).toBeTruthy();
    const applied = (await call(client, "apply_edit", { proposal_id: proposed.proposal_id })) as { ok: boolean };
    expect(applied.ok).toBe(true);
    const written = JSON.parse(validManifest(root));
    expect(written.pages[0].groups).toHaveLength(2);
    expect(written.pages[0].islands).toBeUndefined();
  });

  it("a binding error inside a group is rejected naming the right page + flat index", async () => {
    const root = freshProject();
    const client = await connect(root);
    const grouped = regroup(root) as { pages: { groups: { islands: Record<string, unknown>[] }[] }[] };
    // break the second group's first island (flat index 1: headline holds index 0)
    grouped.pages[0].groups[1]!.islands[0]!.y = "does_not_exist";
    const out = (await call(client, "replace_manifest", { manifest: JSON.stringify(grouped) })) as {
      ok: boolean;
      proposal_id?: string;
      errors: { page: string; index: number }[];
    };
    expect(out.ok).toBe(false);
    expect(out.proposal_id).toBeUndefined();
    expect(out.errors.some((e) => e.page === "overview" && e.index === 1)).toBe(true);
  });
});

describe("prompt-injection posture", () => {
  it("a malicious data cell flows through reads without widening the edit surface", async () => {
    const client = await connect(freshProject());
    const { rows } = (await call(client, "run_sql", { dataset: "notes" })) as { rows: { note: string }[] };
    expect(rows.some((r) => r.note.includes("ignore previous instructions"))).toBe(true);
    const schema = (await call(client, "get_data_schema", { dataset: "notes" })) as { columns: unknown[] };
    expect(schema.columns.length).toBe(2);
  });

  it("a proposal with a dataset source escaping the root is rejected", async () => {
    const root = freshProject();
    const client = await connect(root);
    for (const evil of ["../../etc/passwd", "/etc/passwd", ".env"]) {
      const m = JSON.parse(validManifest(root));
      m.datasets.evil = { source: evil };
      m.pages[0].islands = [{ type: "note.card", title: "x", markdown: "x" }];
      const out = (await call(client, "replace_manifest", { manifest: JSON.stringify(m) })) as { ok: boolean };
      expect(out.ok, evil).toBe(false);
    }
  });
});

const allocationCsv = (root: string) => readFileSync(join(root, "data", "allocation.csv"), "utf8");

describe("data actions", () => {
  it("list_actions returns the declared action with a row schema naming the CSV columns", async () => {
    const client = await connect(freshProject());
    const { actions } = (await call(client, "list_actions")) as { actions: { name: string; dataset: string; mode: string; rowSchema: { properties: Record<string, unknown> } }[] };
    expect(actions).toHaveLength(1);
    const action = actions[0]!;
    expect(action.name).toBe("log_allocation");
    expect(action.dataset).toBe("allocation");
    expect(action.mode).toBe("insert");
    expect(Object.keys(action.rowSchema.properties).toSorted()).toEqual(["class", "value_eur"]);
  });

  it("list_actions returns an empty list when no actions are declared", async () => {
    const root = freshProject();
    const m = JSON.parse(validManifest(root));
    delete m.actions;
    writeFileSync(join(root, "manifest.json"), JSON.stringify(m));
    const client = await connect(root);
    const { actions } = (await call(client, "list_actions")) as { actions: unknown[] };
    expect(actions).toEqual([]);
  });

  it("run_action inserts a valid row that run_sql then sees", async () => {
    const root = freshProject();
    const client = await connect(root);
    const before = allocationCsv(root);

    const out = (await call(client, "run_action", { name: "log_allocation", rows: [{ class: "Stocks", value_eur: 250000 }] })) as { ok: boolean; inserted: number; checkpoint_id: string };
    expect(out.ok).toBe(true);
    expect(out.inserted).toBe(1);
    expect(out.checkpoint_id).toMatch(/^ckpt-\d+!/);
    expect(allocationCsv(root).length).toBeGreaterThan(before.length);

    const { rows } = (await call(client, "run_sql", { dataset: "allocation" })) as { rows: { class: string; value_eur: number }[] };
    expect(rows.some((r) => r.class === "Stocks" && r.value_eur === 250000)).toBe(true);
  });

  it("an invalid row is rejected naming row + field and leaves the file untouched", async () => {
    const root = freshProject();
    const client = await connect(root);
    const before = allocationCsv(root);

    const wrongType = (await call(client, "run_action", { name: "log_allocation", rows: [{ class: "BTC", value_eur: "lots" }] })) as { ok: boolean; errors: { row: number; field: string }[] };
    expect(wrongType.ok).toBe(false);
    expect(wrongType.errors.some((e) => e.row === 0 && e.field === "value_eur")).toBe(true);

    const outOfEnum = (await call(client, "run_action", { name: "log_allocation", rows: [{ class: "Gold", value_eur: 1 }] })) as { ok: boolean; errors: { row: number; field: string }[] };
    expect(outOfEnum.ok).toBe(false);
    expect(outOfEnum.errors.some((e) => e.row === 0 && e.field === "class")).toBe(true);

    expect(allocationCsv(root)).toBe(before);
  });

  it("an undeclared action is rejected listing the declared names", async () => {
    const client = await connect(freshProject());
    const out = (await call(client, "run_action", { name: "log_meal", rows: [{ x: 1 }] })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unknown action/i);
    expect(out.error).toMatch(/log_allocation/);
  });

  it("an empty rows array and an over-cap batch are both rejected", async () => {
    const client = await connect(freshProject());
    const empty = (await call(client, "run_action", { name: "log_allocation", rows: [] })) as { ok: boolean };
    expect(empty.ok).toBe(false);

    const tooMany = Array.from({ length: 101 }, () => ({ class: "Cash", value_eur: 1 }));
    const over = (await call(client, "run_action", { name: "log_allocation", rows: tooMany })) as { ok: boolean; error: string };
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/too many rows/i);
  });

  it("rollback restores a pre-action data snapshot byte-for-byte", async () => {
    const root = freshProject();
    const client = await connect(root);
    const original = allocationCsv(root);

    const out = (await call(client, "run_action", { name: "log_allocation", rows: [{ class: "Stocks", value_eur: 99 }] })) as { checkpoint_id: string };
    expect(allocationCsv(root)).not.toBe(original);

    const back = (await call(client, "rollback", { checkpoint_id: out.checkpoint_id })) as { ok: boolean; restored: string };
    expect(back.ok).toBe(true);
    expect(back.restored).toBe(out.checkpoint_id);
    expect(allocationCsv(root)).toBe(original);
  });

  it("list_checkpoints shows manifest and data checkpoints together", async () => {
    const root = freshProject();
    const client = await connect(root);

    const next = JSON.parse(validManifest(root));
    next.title = "Edited";
    const proposed = (await call(client, "replace_manifest", { manifest: JSON.stringify(next) })) as { proposal_id: string };
    await call(client, "apply_edit", { proposal_id: proposed.proposal_id });

    await call(client, "run_action", { name: "log_allocation", rows: [{ class: "Cash", value_eur: 5 }] });

    const { checkpoints } = (await call(client, "list_checkpoints")) as { checkpoints: string[] };
    expect(checkpoints.some((c) => /^ckpt-\d+$/.test(c))).toBe(true);
    expect(checkpoints.some((c) => /^ckpt-\d+!/.test(c))).toBe(true);
  });

  it("a malicious row value is inserted as a single cell without widening the write surface", async () => {
    const root = freshProject();
    const client = await connect(root);
    const otherBefore = readFileSync(join(root, "data", "net_worth_monthly.csv"), "utf8");
    const payload = '=cmd()|"\n,,,"';

    const out = (await call(client, "run_action", { name: "log_allocation", rows: [{ class: "Stocks", value_eur: 1 }] })) as { ok: boolean };
    expect(out.ok).toBe(true);

    // A payload that escapes the enum is rejected; use an action without the enum to prove cell-confinement.
    const m = JSON.parse(validManifest(root));
    m.actions.log_note = { dataset: "notes", mode: "insert" };
    writeFileSync(join(root, "manifest.json"), JSON.stringify(m));
    const client2 = await connect(root);

    const written = (await call(client2, "run_action", { name: "log_note", rows: [{ id: 9, note: payload }] })) as { ok: boolean };
    expect(written.ok).toBe(true);

    expect(readFileSync(join(root, "data", "net_worth_monthly.csv"), "utf8")).toBe(otherBefore);
    const { rows } = (await call(client2, "run_sql", { dataset: "notes" })) as { rows: { id: number; note: string }[] };
    const cell = rows.find((r) => Number(r.id) === 9);
    expect(cell?.note).toBe(payload);
  });

  it("an action targeting a sql dataset fails validate_manifest loudly", async () => {
    const root = freshProject();
    const client = await connect(root);
    const m = JSON.parse(validManifest(root));
    m.datasets.derived = { sql: "models/derived.sql" };
    m.actions.bad = { dataset: "derived", mode: "insert" };
    const out = (await call(client, "validate_manifest", { manifest: JSON.stringify(m) })) as { ok: boolean; errors: unknown[] };
    expect(out.ok).toBe(false);
    expect(out.errors.length).toBeGreaterThan(0);
  });
});

const notesCsv = (root: string) => readFileSync(join(root, "data", "notes.csv"), "utf8");

/** Add a second writable action (`log_note` → the `notes` dataset, no field overrides) so a batch
 * can span two distinct datasets. Returns the same app dir for chaining. */
function withNotesAction(root: string): string {
  const m = JSON.parse(validManifest(root));
  m.actions.log_note = { dataset: "notes", mode: "insert" };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(m));
  return root;
}

interface RunActionsResult {
  ok: boolean;
  atomic?: boolean;
  results?: { action: string; ok?: boolean; mode?: string; inserted?: number; replaced?: number; deleted?: number; updated?: number; checkpoint_id?: string; error?: string }[];
  checkpoint_ids?: string[];
  failures?: { action: string; index: number; error?: string; errors?: unknown[] }[];
  error?: string;
  rolled_back?: string[];
}

/** Run a runActions program and return its envelope. */
async function runActions(client: Client, calls: unknown[], opts?: { atomic?: boolean }): Promise<RunActionsResult> {
  const optsArg = opts === undefined ? "" : `, ${JSON.stringify(opts)}`;
  const code = `return await oi.app().runActions(${JSON.stringify(calls)}${optsArg});`;
  return runResult(client, code);
}

/** Declare a write-mode action of `mode` against the `notes` dataset (no field overrides), plus the
 * insert-mode `log_allocation` already in the fixture. Returns the same app dir for chaining. */
function withNoteMode(root: string, mode: "insert" | "replace" | "delete" | "update"): string {
  const m = JSON.parse(validManifest(root));
  m.actions.note_action = { dataset: "notes", mode };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(m));
  return root;
}

const allNotes = async (client: Client): Promise<{ id: number; note: string }[]> => {
  const { rows } = (await call(client, "run_sql", { dataset: "notes" })) as { rows: { id: number; note: string }[] };
  return rows.map((r) => ({ id: Number(r.id), note: r.note }));
};

describe("runActions (atomic multi-write)", () => {
  it("atomic success appends every call's rows and returns the data checkpoint ids", async () => {
    const root = withNotesAction(freshProject());
    const client = await connect(root);

    const out = await runActions(client, [
      { action: "log_allocation", rows: [{ class: "Stocks", value_eur: 250000 }] },
      { action: "log_note", rows: [{ id: 9, note: "rebalanced" }] },
    ]);

    expect(out.ok).toBe(true);
    expect(out.atomic).toBe(true);
    expect(out.results).toHaveLength(2);
    expect(out.results!.every((r) => r.ok === true)).toBe(true);
    expect(out.checkpoint_ids!.length).toBe(2);
    expect(out.checkpoint_ids!.every((id) => /^ckpt-\d+!/.test(id))).toBe(true);

    const alloc = (await call(client, "run_sql", { dataset: "allocation" })) as { rows: { class: string; value_eur: number }[] };
    expect(alloc.rows.some((r) => r.class === "Stocks" && r.value_eur === 250000)).toBe(true);
    const notes = (await call(client, "run_sql", { dataset: "notes" })) as { rows: { id: number; note: string }[] };
    expect(notes.rows.some((r) => Number(r.id) === 9 && r.note === "rebalanced")).toBe(true);
  });

  it("atomic all-or-nothing: one invalid row aborts the batch and writes NOTHING", async () => {
    const root = withNotesAction(freshProject());
    const client = await connect(root);
    const allocBefore = allocationCsv(root);
    const notesBefore = notesCsv(root);

    const out = await runActions(client, [
      { action: "log_allocation", rows: [{ class: "Stocks", value_eur: 250000 }] },
      { action: "log_note", rows: [{ id: 5, note: "first" }] },
      { action: "log_allocation", rows: [{ class: "BTC", value_eur: "lots" }] },
    ]);

    expect(out.ok).toBe(false);
    expect(out.atomic).toBe(true);
    const failure = out.failures!.find((f) => f.index === 2);
    expect(failure).toBeDefined();
    expect(failure!.action).toBe("log_allocation");
    expect((failure!.errors as { row: number; field: string }[]).some((e) => e.field === "value_eur")).toBe(true);

    expect(allocationCsv(root)).toBe(allocBefore);
    expect(notesCsv(root)).toBe(notesBefore);
  });

  it("atomic all-or-nothing names an unknown action without writing the valid call's rows", async () => {
    const root = freshProject();
    const client = await connect(root);
    const allocBefore = allocationCsv(root);

    const out = await runActions(client, [
      { action: "log_allocation", rows: [{ class: "Cash", value_eur: 1 }] },
      { action: "log_meal", rows: [{ x: 1 }] },
    ]);

    expect(out.ok).toBe(false);
    expect(out.atomic).toBe(true);
    const failure = out.failures!.find((f) => f.index === 1)!;
    expect(failure.action).toBe("log_meal");
    expect(failure.error).toMatch(/unknown action/i);
    expect(allocationCsv(root)).toBe(allocBefore);
  });

  it("empty batch is rejected", async () => {
    const client = await connect(freshProject());
    const out = await runActions(client, []);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no actions/i);
  });

  it("non-atomic applies the good calls and reports the bad one per-call", async () => {
    const root = withNotesAction(freshProject());
    const client = await connect(root);
    const before = allocationCsv(root);

    const out = await runActions(
      client,
      [
        { action: "log_allocation", rows: [{ class: "Stocks", value_eur: 7 }] },
        { action: "log_allocation", rows: [{ class: "Gold", value_eur: 1 }] },
        { action: "log_note", rows: [{ id: 3, note: "kept" }] },
      ],
      { atomic: false },
    );

    expect(out.atomic).toBe(false);
    expect(out.ok).toBe(false);
    const byIndex = out.results!;
    expect(byIndex[0]!.ok).toBe(true);
    expect(byIndex[1]!.ok).toBe(false);
    expect(byIndex[2]!.ok).toBe(true);

    expect(allocationCsv(root).length).toBeGreaterThan(before.length);
    const alloc = (await call(client, "run_sql", { dataset: "allocation" })) as { rows: { class: string; value_eur: number }[] };
    expect(alloc.rows.some((r) => r.class === "Stocks" && r.value_eur === 7)).toBe(true);
    expect(alloc.rows.some((r) => r.class === "Gold")).toBe(false);
    const notes = (await call(client, "run_sql", { dataset: "notes" })) as { rows: { id: number; note: string }[] };
    expect(notes.rows.some((r) => Number(r.id) === 3 && r.note === "kept")).toBe(true);
  });

  it("non-atomic all-ok reports ok:true", async () => {
    const root = withNotesAction(freshProject());
    const client = await connect(root);
    const out = await runActions(
      client,
      [
        { action: "log_allocation", rows: [{ class: "Stocks", value_eur: 11 }] },
        { action: "log_note", rows: [{ id: 12, note: "ok" }] },
      ],
      { atomic: false },
    );
    expect(out.ok).toBe(true);
    expect(out.atomic).toBe(false);
    expect(out.results!.every((r) => r.ok === true)).toBe(true);
  });
});

describe("runActions write modes (delete / update / replace)", () => {
  it("delete removes the matching row, leaving the survivors", async () => {
    const root = withNoteMode(freshProject(), "delete");
    const client = await connect(root);
    expect(await allNotes(client)).toHaveLength(2);

    const out = await runActions(client, [{ action: "note_action", match: { id: 1 } }]);
    expect(out.ok).toBe(true);
    const result = out.results![0]!;
    expect(result.mode).toBe("delete");
    expect(result.deleted).toBe(1);
    expect(result.checkpoint_id).toMatch(/^ckpt-\d+!/);

    const remaining = await allNotes(client);
    expect(remaining).toEqual([{ id: 2, note: "normal note" }]);
  });

  it("update patches every matching row's set fields", async () => {
    const root = withNoteMode(freshProject(), "update");
    const client = await connect(root);

    const out = await runActions(client, [{ action: "note_action", match: { id: 2 }, set: { note: "patched" } }]);
    expect(out.ok).toBe(true);
    const result = out.results![0]!;
    expect(result.mode).toBe("update");
    expect(result.updated).toBe(1);

    const after = await allNotes(client);
    expect(after.find((r) => r.id === 2)!.note).toBe("patched");
    expect(after.find((r) => r.id === 1)!.note).toMatch(/ignore previous/);
  });

  it("replace overwrites all rows of the dataset", async () => {
    const root = withNoteMode(freshProject(), "replace");
    const client = await connect(root);

    const out = await runActions(client, [{ action: "note_action", rows: [{ id: 7, note: "only" }] }]);
    expect(out.ok).toBe(true);
    const result = out.results![0]!;
    expect(result.mode).toBe("replace");
    expect(result.replaced).toBe(1);

    expect(await allNotes(client)).toEqual([{ id: 7, note: "only" }]);
  });

  it("delete without a match predicate is rejected and writes nothing", async () => {
    const root = withNoteMode(freshProject(), "delete");
    const client = await connect(root);
    const before = notesCsv(root);

    const out = await runActions(client, [{ action: "note_action", match: {} }]);
    expect(out.ok).toBe(false);
    expect(out.failures![0]!.error).toMatch(/non-empty match/i);
    expect(notesCsv(root)).toBe(before);
  });

  it("update without a set patch is rejected and writes nothing", async () => {
    const root = withNoteMode(freshProject(), "update");
    const client = await connect(root);
    const before = notesCsv(root);

    const out = await runActions(client, [{ action: "note_action", match: { id: 2 } }]);
    expect(out.ok).toBe(false);
    expect(out.failures![0]!.error).toMatch(/non-empty set/i);
    expect(notesCsv(root)).toBe(before);
  });

  it("atomic all-or-nothing across mixed modes: a valid insert + a delete missing match writes NOTHING", async () => {
    const root = withNoteMode(freshProject(), "delete");
    const client = await connect(root);
    const allocBefore = allocationCsv(root);
    const notesBefore = notesCsv(root);

    const out = await runActions(client, [
      { action: "log_allocation", rows: [{ class: "Stocks", value_eur: 5 }] },
      { action: "note_action", match: {} },
    ]);

    expect(out.ok).toBe(false);
    expect(out.atomic).toBe(true);
    const failure = out.failures!.find((f) => f.index === 1)!;
    expect(failure.action).toBe("note_action");
    expect(failure.error).toMatch(/non-empty match/i);

    expect(allocationCsv(root)).toBe(allocBefore);
    expect(notesCsv(root)).toBe(notesBefore);
  });
});

describe("read queries", () => {
  function withQuery(root: string, queries: Record<string, unknown>): string {
    const m = JSON.parse(validManifest(root));
    m.queries = queries;
    writeFileSync(join(root, "manifest.json"), JSON.stringify(m));
    return root;
  }

  it("list_queries returns the declared query with a params JSON Schema and columns", async () => {
    const root = withQuery(freshProject(), {
      alloc_by_class: {
        dataset: "allocation",
        description: "Allocation for one class",
        select: ["class", "value_eur"],
        params: { class: { type: "string" } },
        where: [{ field: "class", op: "eq", param: "class" }],
      },
    });
    const client = await connect(root);
    const { queries } = (await call(client, "list_queries")) as {
      queries: {
        name: string;
        description?: string;
        params: { properties?: Record<string, unknown>; required?: string[] };
        columns: { name: string }[];
      }[];
    };
    expect(queries).toHaveLength(1);
    const q = queries[0]!;
    expect(q.name).toBe("alloc_by_class");
    expect(Object.keys(q.params.properties ?? {})).toEqual(["class"]);
    expect(q.columns.map((c) => c.name)).toEqual(["class", "value_eur"]);
  });

  it("list_queries returns an empty list when none are declared", async () => {
    const client = await connect(freshProject());
    expect(((await call(client, "list_queries")) as { queries: unknown[] }).queries).toEqual([]);
  });

  it("run_query returns rows for valid params", async () => {
    const root = withQuery(freshProject(), {
      alloc_by_class: { dataset: "allocation", select: ["class", "value_eur"], params: { class: { type: "string" } }, where: [{ field: "class", op: "eq", param: "class" }] },
    });
    const client = await connect(root);
    const out = (await call(client, "run_query", { name: "alloc_by_class", params: { class: "BTC" } })) as {
      ok: boolean;
      rowCount: number;
      rows: { class: string; value_eur: number }[];
    };
    expect(out.ok).toBe(true);
    expect(out.rowCount).toBe(1);
    expect(out.rows[0]!.class).toBe("BTC");
  });

  it("run_query rejects an unknown query name listing the declared ones", async () => {
    const root = withQuery(freshProject(), {
      alloc_by_class: { dataset: "allocation", select: ["class"], params: { class: { type: "string" } }, where: [{ field: "class", op: "eq", param: "class" }] },
    });
    const client = await connect(root);
    const out = (await call(client, "run_query", { name: "ghost" })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unknown query/i);
    expect(out.error).toMatch(/alloc_by_class/);
  });

  it("run_query rejects a missing/bad param naming it", async () => {
    const root = withQuery(freshProject(), {
      by_value: { dataset: "allocation", select: ["class"], params: { min: { type: "number" } }, where: [{ field: "value_eur", op: "gte", param: "min" }] },
    });
    const client = await connect(root);
    const missing = (await call(client, "run_query", { name: "by_value" })) as { ok: boolean; errors: { param: string }[] };
    expect(missing.ok).toBe(false);
    expect(missing.errors.some((e) => e.param === "min")).toBe(true);

    const wrongType = (await call(client, "run_query", { name: "by_value", params: { min: "lots" } })) as { ok: boolean; errors: { param: string }[] };
    expect(wrongType.ok).toBe(false);
    expect(wrongType.errors.some((e) => e.param === "min")).toBe(true);
  });

  it("an agent can author a query end-to-end via replace_manifest → apply_edit", async () => {
    const root = freshProject();
    const client = await connect(root);

    const next = JSON.parse(validManifest(root));
    expect(next.queries).toBeUndefined();
    next.queries = {
      alloc_by_class: {
        dataset: "allocation",
        description: "Allocation for one asset class",
        select: ["class", "value_eur"],
        params: { class: { type: "string" } },
        where: [{ field: "class", op: "eq", param: "class" }],
      },
    };
    const proposed = (await call(client, "replace_manifest", { manifest: JSON.stringify(next) })) as { ok: boolean; proposal_id?: string; errors?: unknown[] };
    expect(proposed.ok, JSON.stringify(proposed.errors)).toBe(true);
    expect(proposed.proposal_id).toBeTruthy();

    const applied = (await call(client, "apply_edit", { proposal_id: proposed.proposal_id! })) as { ok: boolean };
    expect(applied.ok).toBe(true);

    const { queries: listed } = (await call(client, "list_queries")) as { queries: { name: string }[] };
    expect(listed.some((q) => q.name === "alloc_by_class")).toBe(true);

    const ran = (await call(client, "run_query", { name: "alloc_by_class", params: { class: "ETH" } })) as { ok: boolean; rows: { class: string; value_eur: number }[] };
    expect(ran.ok).toBe(true);
    expect(ran.rows[0]!.class).toBe("ETH");
  });

  it("replace_manifest rejects a query whose field is not a column (checkQueries runs in dryCheck)", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.queries = { broken: { dataset: "allocation", where: [{ field: "ghost_col", op: "eq", value: 1 }] } };
    const out = (await call(client, "replace_manifest", { manifest: JSON.stringify(next) })) as { ok: boolean; proposal_id?: string; errors: string[] };
    expect(out.ok).toBe(false);
    expect(out.proposal_id).toBeUndefined();
    expect(out.errors.some((e) => typeof e === "string" && e.includes("ghost_col"))).toBe(true);
  });
});

const DEMO_CONNECTOR = `
import { defineConnector } from "@openislands/connector-kit";
import { z } from "zod";

export default defineConnector({
  description: "Deterministic test connector",
  config: z.object({ count: z.number().default(2) }),
  secrets: ["DEMO_TOKEN"],
  schedule: "6h",
  outputs: { logs: { description: "appended events" } },
  async sync(ctx) {
    const seen = typeof ctx.state.seen === "number" ? ctx.state.seen : 0;
    const logs = [];
    for (let i = 0; i < ctx.config.count; i += 1) logs.push({ id: seen + i, label: "event-" + (seen + i) });
    await ctx.insert("logs", logs);
    ctx.state.seen = seen + ctx.config.count;
  },
});
`;

function connectorProject(): string {
  const workspace = mkdtempSync(join(tmpdir(), "oi-mcp-conn-"));
  const dir = join(workspace, "apps", "demo");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  mkdirSync(join(dir, "connectors", "demo"), { recursive: true });
  const manifest = {
    version: 1,
    title: "Demo",
    datasets: { logs: { source: "data/logs.csv" } },
    pages: [{ id: "p", islands: [{ type: "note.card", markdown: "x" }] }],
    connectors: { demo: { module: "connectors/demo", datasets: { logs: "logs" }, config: { count: 2 } } },
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "connectors", "demo", "index.ts"), DEMO_CONNECTOR);
  roots.push(dir);
  return dir;
}

describe("connectors", () => {
  afterEach(() => {
    delete process.env.DEMO_TOKEN;
  });

  it("list_connectors reports an unconnected connector with its missing secret", async () => {
    const client = await connect(connectorProject());
    const { connectors: statuses } = (await call(client, "list_connectors")) as { connectors: { name: string; auth: string; connected: boolean; missingSecrets: string[]; schedule?: string }[] };
    const demo = statuses.find((s) => s.name === "demo")!;
    expect(demo.auth).toBe("none");
    expect(demo.connected).toBe(false);
    expect(demo.missingSecrets).toContain("DEMO_TOKEN");
    expect(demo.schedule).toBe("6h");
  });

  it("run_sync pulls rows into the dataset that run_sql then sees", async () => {
    process.env.DEMO_TOKEN = "t";
    const client = await connect(connectorProject());
    const result = (await call(client, "run_sync", { name: "demo" })) as { connector: string; datasets: Record<string, { mode: string; rows: number; checkpoint_id?: string }> };
    expect(result.connector).toBe("demo");
    expect(result.datasets.logs!.mode).toBe("insert");
    expect(result.datasets.logs!.rows).toBe(2);

    const { rows } = (await call(client, "run_sql", { dataset: "logs" })) as { rows: unknown[] };
    expect(rows.length).toBe(2);
  });

  it("run_sync returns a structured error for an unknown connector", async () => {
    const client = await connect(connectorProject());
    const out = (await call(client, "run_sync", { name: "ghost" })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toBeTruthy();
  });
});

const GAUGE_SCHEMA = `import { z } from "zod";
export default z.object({
  type: z.literal("gauge.ring"),
  dataset: z.string(),
  rings: z.array(z.object({ value: z.string(), max: z.union([z.string(), z.number()]) })).min(1),
});
`;

function withGaugeSchema(root: string): void {
  const dir = join(root, "components", "custom", "gauge.ring");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "schema.ts"), GAUGE_SCHEMA);
}

function gaugeManifest(root: string, rings: unknown): string {
  const m = JSON.parse(validManifest(root));
  m.pages[0].islands = [{ type: "gauge.ring", title: "Rings", dataset: "allocation", rings }];
  return JSON.stringify(m);
}

afterEach(() => resetCustomSchemaCache());

describe("custom island schema enforcement (replace_manifest)", () => {
  it("rejects a bad gauge.ring config naming the page/index/type/field", async () => {
    const root = freshProject();
    withGaugeSchema(root);
    const client = await connect(root);
    const out = (await call(client, "replace_manifest", {
      manifest: gaugeManifest(root, [{ max: "value_eur" }]),
    })) as { ok: boolean; proposal_id?: string; errors: { page: string; index: number; type: string; field?: string }[] };
    expect(out.ok).toBe(false);
    expect(out.proposal_id).toBeUndefined();
    const err = out.errors.find((e) => e.type === "gauge.ring");
    expect(err).toBeDefined();
    expect(err!.page).toBe("overview");
    expect(err!.index).toBe(0);
  });

  it("accepts a valid gauge.ring config and returns a proposal_id", async () => {
    const root = freshProject();
    withGaugeSchema(root);
    const client = await connect(root);
    const out = (await call(client, "replace_manifest", {
      manifest: gaugeManifest(root, [{ value: "value_eur", max: "value_eur" }]),
    })) as { ok: boolean; proposal_id?: string };
    expect(out.ok).toBe(true);
    expect(out.proposal_id).toBeDefined();
  });
});

describe("page filter bind enforcement (replace_manifest)", () => {
  it("rejects a filter bound to a missing column with a structured error", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.pages[0].filters = [{ id: "period", type: "daterange", bind: { net_worth_monthly: "ghost" } }];
    const out = (await call(client, "replace_manifest", { manifest: JSON.stringify(next) })) as {
      ok: boolean;
      proposal_id?: string;
      errors: { page: string; type: string; message: string }[];
    };
    expect(out.ok).toBe(false);
    expect(out.proposal_id).toBeUndefined();
    const err = out.errors.find((e) => e.type === "filter");
    expect(err).toBeDefined();
    expect(err!.page).toBe("overview");
    expect(err!.message).toContain("ghost");
  });

  it("accepts a filter bound to an existing column", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.pages[0].filters = [{ id: "period", type: "daterange", label: "Period", bind: { net_worth_monthly: "month" } }];
    const out = (await call(client, "replace_manifest", { manifest: JSON.stringify(next) })) as { ok: boolean; proposal_id?: string };
    expect(out.ok).toBe(true);
    expect(out.proposal_id).toBeDefined();
  });
});

describe("M7 catalog additions are discoverable + bindable", () => {
  it("list_islands includes the new island types with their required fields", async () => {
    const client = await connect(freshProject());
    const { islands } = (await call(client, "list_islands")) as { islands: { type: string; required: string[] }[] };
    const required = (type: string) => islands.find((i) => i.type === type)?.required;
    expect(required("category.combo")).toEqual(["dataset", "x", "bars", "lines"]);
    expect(required("rank.list")).toEqual(["dataset", "label", "value"]);
    expect(required("status.grid")).toEqual(["dataset", "label", "state"]);
    expect(required("waterfall.bars")).toEqual(["dataset", "label", "value"]);
  });

  it("get_island_schema returns a JSON-Schema for a new type naming its required fields", async () => {
    const client = await connect(freshProject());
    const waterfall = (await call(client, "get_island_schema", { type: "waterfall.bars" })) as {
      schema: { properties: Record<string, unknown>; required: string[] };
    };
    expect(waterfall.schema.required).toEqual(expect.arrayContaining(["label", "value"]));
    expect(Object.keys(waterfall.schema.properties)).toEqual(expect.arrayContaining(["label", "value"]));

    const rank = (await call(client, "get_island_schema", { type: "rank.list" })) as {
      schema: { properties: Record<string, unknown>; required: string[] };
    };
    expect(rank.schema.required).toEqual(expect.arrayContaining(["label", "value"]));
    expect(Object.keys(rank.schema.properties)).toEqual(expect.arrayContaining(["label", "value"]));
  });

  it("propose → apply accepts a new island plus a select filter bound to real columns", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.pages[0].filters = [{ id: "asset", type: "select", label: "Asset class", bind: { allocation: "class" }, multiple: true }];
    next.pages[0].islands.push({
      type: "category.combo",
      title: "Net worth vs target",
      dataset: "net_worth_monthly",
      x: "month",
      bars: "net_worth_eur",
      lines: "target_eur",
      span: 12,
    });
    const proposed = (await call(client, "replace_manifest", { manifest: JSON.stringify(next) })) as { ok: boolean; proposal_id: string };
    expect(proposed.ok).toBe(true);
    expect(proposed.proposal_id).toBeTruthy();
    const applied = (await call(client, "apply_edit", { proposal_id: proposed.proposal_id })) as { ok: boolean };
    expect(applied.ok).toBe(true);
    const written = JSON.parse(validManifest(root));
    expect(written.pages[0].filters[0].type).toBe("select");
    expect(written.pages[0].islands.at(-1).type).toBe("category.combo");
  });

  it("rejects a binding error inside a new island naming the page + flat index + type + field", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.pages[0].islands.push({ type: "rank.list", title: "Top assets", dataset: "allocation", label: "class", value: "does_not_exist" });
    const out = (await call(client, "replace_manifest", { manifest: JSON.stringify(next) })) as {
      ok: boolean;
      proposal_id?: string;
      errors: { page: string; index: number; type: string; field?: string; message: string }[];
    };
    expect(out.ok).toBe(false);
    expect(out.proposal_id).toBeUndefined();
    const err = out.errors.find((e) => e.type === "rank.list");
    expect(err).toBeDefined();
    expect(err!.page).toBe("overview");
    expect(err!.index).toBe(3);
    expect(err!.field).toBe("does_not_exist");
    expect(err!.message).toContain("does_not_exist");
  });
});

describe("replace_manifest accepts a manifest object", () => {
  it("takes a JSON object directly (no double-encoding) and applies it", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.title = "Object edit";
    const proposed = (await call(client, "replace_manifest", { manifest: next })) as { ok: boolean; proposal_id?: string; errors?: unknown[] };
    expect(proposed.ok, JSON.stringify(proposed.errors)).toBe(true);
    const applied = (await call(client, "apply_edit", { proposal_id: proposed.proposal_id! })) as { ok: boolean };
    expect(applied.ok).toBe(true);
    expect(JSON.parse(validManifest(root)).title).toBe("Object edit");
  });
});

describe("patch_manifest — section-level CRUD", () => {
  it("adds a query incrementally without re-sending the whole manifest", async () => {
    const root = freshProject();
    const client = await connect(root);
    const out = (await call(client, "patch_manifest", {
      queries: {
        alloc_by_class: { dataset: "allocation", select: ["class", "value_eur"], params: { class: { type: "string" } }, where: [{ field: "class", op: "eq", param: "class" }] },
      },
    })) as { ok: boolean; proposal_id?: string; errors?: unknown[] };
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    await call(client, "apply_edit", { proposal_id: out.proposal_id! });
    const written = JSON.parse(validManifest(root));
    expect(Object.keys(written.queries)).toEqual(["alloc_by_class"]);
    // untouched sections survive the patch
    expect(written.title).toBe("Finance Overview");
    expect(written.pages[0].islands).toHaveLength(3);
  });

  it("adds a dataset from a new file and binds it in one patch", async () => {
    const root = freshProject();
    writeFileSync(join(root, "data", "crypto.csv"), "coin,amount_eur\nBTC,50000\nETH,20000\n");
    const client = await connect(root);
    const page = JSON.parse(validManifest(root)).pages[0];
    page.islands.push({ type: "rank.list", title: "Crypto", dataset: "crypto", label: "coin", value: "amount_eur", span: 12 });
    const out = (await call(client, "patch_manifest", {
      datasets: { crypto: { source: "data/crypto.csv", description: "holdings" } },
      pages: [page],
    })) as { ok: boolean; proposal_id?: string; errors?: unknown[] };
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
    await call(client, "apply_edit", { proposal_id: out.proposal_id! });
    const written = JSON.parse(validManifest(root));
    expect(written.datasets.crypto.source).toBe("data/crypto.csv");
    expect(written.pages[0].islands.at(-1).type).toBe("rank.list");
  });

  it("upserts a page by id rather than appending a duplicate", async () => {
    const root = freshProject();
    const client = await connect(root);
    const page = JSON.parse(validManifest(root)).pages[0];
    page.islands.push({ type: "note.card", title: "Note", markdown: "hello", span: 12 });
    const out = (await call(client, "patch_manifest", { pages: [page] })) as { ok: boolean; proposal_id?: string };
    expect(out.ok).toBe(true);
    await call(client, "apply_edit", { proposal_id: out.proposal_id! });
    const written = JSON.parse(validManifest(root));
    expect(written.pages).toHaveLength(1);
    expect(written.pages[0].islands.at(-1).type).toBe("note.card");
  });

  it("appends a brand-new page by a new id", async () => {
    const root = freshProject();
    const client = await connect(root);
    const out = (await call(client, "patch_manifest", {
      pages: [{ id: "extra", title: "Extra", islands: [{ type: "note.card", markdown: "x", span: 12 }] }],
    })) as { ok: boolean; proposal_id?: string };
    expect(out.ok).toBe(true);
    await call(client, "apply_edit", { proposal_id: out.proposal_id! });
    const written = JSON.parse(validManifest(root));
    expect(written.pages.map((p: { id: string }) => p.id)).toEqual(["overview", "extra"]);
  });

  it("removes a section entry with null", async () => {
    const root = freshProject();
    const client = await connect(root);
    expect(JSON.parse(validManifest(root)).actions.log_allocation).toBeDefined();
    const out = (await call(client, "patch_manifest", { actions: { log_allocation: null } })) as { ok: boolean; proposal_id?: string };
    expect(out.ok).toBe(true);
    await call(client, "apply_edit", { proposal_id: out.proposal_id! });
    expect(JSON.parse(validManifest(root)).actions).toBeUndefined();
  });

  it("removes a page by id", async () => {
    const root = freshProject();
    const client = await connect(root);
    await call(client, "patch_manifest", { pages: [{ id: "extra", islands: [{ type: "note.card", markdown: "x", span: 12 }] }] }).then((o) =>
      call(client, "apply_edit", { proposal_id: (o as { proposal_id: string }).proposal_id }),
    );
    const out = (await call(client, "patch_manifest", { remove_pages: ["extra"] })) as { ok: boolean; proposal_id?: string };
    expect(out.ok).toBe(true);
    await call(client, "apply_edit", { proposal_id: out.proposal_id! });
    expect(JSON.parse(validManifest(root)).pages.map((p: { id: string }) => p.id)).toEqual(["overview"]);
  });

  it("rejects an invalid patch naming the offending field and returns no proposal_id", async () => {
    const root = freshProject();
    const client = await connect(root);
    const out = (await call(client, "patch_manifest", {
      queries: { broken: { dataset: "allocation", where: [{ field: "ghost_col", op: "eq", value: 1 }] } },
    })) as { ok: boolean; proposal_id?: string; errors: string[] };
    expect(out.ok).toBe(false);
    expect(out.proposal_id).toBeUndefined();
    expect(out.errors.some((e) => typeof e === "string" && e.includes("ghost_col"))).toBe(true);
  });
});

describe("validate_sql — transform dry-run", () => {
  it("returns the columns of a valid SELECT over the views", async () => {
    const client = await connect(freshProject());
    const out = (await call(client, "validate_sql", { sql: "SELECT class, SUM(value_eur) AS total FROM allocation GROUP BY class" })) as {
      ok: boolean;
      columns?: { name: string }[];
    };
    expect(out.ok).toBe(true);
    expect(out.columns!.map((c) => c.name).toSorted()).toEqual(["class", "total"]);
  });

  it("returns the real DuckDB error for an unknown table — not an opaque failure", async () => {
    const client = await connect(freshProject());
    const out = (await call(client, "validate_sql", { sql: "SELECT * FROM ghost_table" })) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/ghost_table/i);
  });

  it("rejects a non-SELECT statement", async () => {
    const client = await connect(freshProject());
    const out = (await call(client, "validate_sql", { sql: "DROP TABLE allocation" })) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/read-only|SELECT/i);
  });
});

describe("dataset readability + path confinement", () => {
  it("accepts a dataset sourced from docs/*.md (markdown is a first-class source)", async () => {
    const root = freshProject();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "strategy.md"), "# Strategy\n\nBuy low.\n");
    const client = await connect(root);
    const out = (await call(client, "patch_manifest", { datasets: { strategy: { source: "docs/strategy.md", description: "notes" } } })) as {
      ok: boolean;
      proposal_id?: string;
      errors?: unknown[];
    };
    expect(out.ok, JSON.stringify(out.errors)).toBe(true);
  });

  it("surfaces the real reason a sql transform is broken without blinding healthy datasets", async () => {
    const root = freshProject();
    mkdirSync(join(root, "models"), { recursive: true });
    writeFileSync(join(root, "models", "broken.sql"), "SELECT * FROM table_that_does_not_exist");
    const client = await connect(root);
    const out = (await call(client, "patch_manifest", { datasets: { derived: { sql: "models/broken.sql" } } })) as {
      ok: boolean;
      errors: string[];
    };
    expect(out.ok).toBe(false);
    const errors = out.errors.map(String);
    // the broken transform names its real catalog error...
    expect(errors.some((e) => e.includes("derived") && /table_that_does_not_exist|does not exist|Catalog/i.test(e))).toBe(true);
    // ...and the healthy datasets are NOT falsely reported as unreadable
    expect(errors.some((e) => e.includes("net_worth_monthly") && /unreadable/i.test(e))).toBe(false);
  });
});

describe("layout guidance", () => {
  it("get_island_schema returns span layout + synthesized notes", async () => {
    const client = await connect(freshProject());
    const out = (await call(client, "get_island_schema", { type: "table.grid" })) as {
      type: string;
      schema: { properties: Record<string, unknown> };
      layout: { minSpan: number; recommendedSpan: number; maxSpan: number };
      notes: string[];
    };
    expect(out.type).toBe("table.grid");
    expect(out.schema.properties).toBeDefined();
    expect(out.layout).toEqual({ minSpan: 5, recommendedSpan: 8, maxSpan: 12 });
    expect(out.notes[0]).toContain("Spans 5–12 columns");
    expect(out.notes.some((n) => n.includes("full 12 columns"))).toBe(true);
  });

  it("get_island_schema flags a compact island and nudges metric.kpi off standalone", async () => {
    const client = await connect(freshProject());
    const kpi = (await call(client, "get_island_schema", { type: "metric.kpi" })) as {
      layout: { minSpan: number; recommendedSpan: number; maxSpan: number };
      notes: string[];
    };
    expect(kpi.layout).toEqual({ minSpan: 2, recommendedSpan: 4, maxSpan: 6 });
    expect(kpi.notes.some((n) => n.includes("compact island"))).toBe(true);
    expect(kpi.notes.some((n) => /standalone KPI/i.test(n) && /metric\.scorecard/.test(n))).toBe(true);
  });

  it("get_island_schema returns a null layout for the structural layout.row", async () => {
    const client = await connect(freshProject());
    // layout.row's schema embeds the whole island catalog, so the program returns only the fields
    // under test rather than the full (cap-busting) envelope.
    const row = await runResult<{ ok: boolean; type: string; hasSchema: boolean; layout: null; firstNote: string }>(
      client,
      `const r = await oi.app().getIslandSchema("layout.row");
       return { ok: r.ok, type: r.type, hasSchema: r.schema !== undefined, layout: r.layout, firstNote: r.notes[0] };`,
    );
    expect(row.type).toBe("layout.row");
    expect(row.hasSchema).toBe(true);
    expect(row.layout).toBeNull();
    expect(row.firstNote).toMatch(/full-width row/i);
  });

  it("list_islands carries the span range for each island", async () => {
    const client = await connect(freshProject());
    const { islands } = (await call(client, "list_islands")) as { islands: { type: string; minSpan?: number; recommendedSpan?: number; maxSpan?: number }[] };
    const kpi = islands.find((i) => i.type === "metric.kpi");
    expect(kpi).toMatchObject({ minSpan: 2, recommendedSpan: 4, maxSpan: 6 });
    const row = islands.find((i) => i.type === "layout.row");
    expect(row?.minSpan).toBeUndefined();
  });

  it("validate_manifest returns advisory warnings without failing a valid manifest", async () => {
    const client = await connect(freshProject());
    const out = (await call(client, "validate_manifest")) as { ok: boolean; warnings: { page: string; type: string }[] };
    expect(out.ok).toBe(true);
    expect(out.warnings.some((w) => w.page === "overview" && w.type === "metric.kpi")).toBe(true);
  });

  it("replace_manifest surfaces a lone-kpi warning but still stages (ok:true)", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.title = "Edited";
    const out = (await call(client, "replace_manifest", { manifest: next })) as { ok: boolean; proposal_id?: string; warnings: { type: string }[] };
    expect(out.ok).toBe(true);
    expect(out.proposal_id).toBeTruthy();
    expect(out.warnings.some((w) => w.type === "metric.kpi")).toBe(true);
  });

  it("patch_manifest warns when a compact island is wider than its recommended span", async () => {
    const root = freshProject();
    const client = await connect(root);
    const page = JSON.parse(validManifest(root)).pages[0];
    page.islands[0].span = 6; // metric.kpi: max 6, recommended 4 — valid but wider than recommended
    const out = (await call(client, "patch_manifest", { pages: [page] })) as { ok: boolean; warnings: { type: string; message: string }[] };
    expect(out.ok).toBe(true);
    expect(out.warnings.some((w) => w.type === "metric.kpi" && /recommended/i.test(w.message))).toBe(true);
  });

  it("a structurally-invalid manifest reports errors with empty warnings", async () => {
    const root = freshProject();
    const client = await connect(root);
    const out = (await call(client, "validate_manifest", { manifest: { version: 1, title: "x", datasets: {} } })) as { ok: boolean; errors: unknown[]; warnings: unknown[] };
    expect(out.ok).toBe(false);
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.warnings).toEqual([]);
  });
});

describe("history hygiene", () => {
  async function applyTitleEdit(client: Client, root: string, title: string): Promise<void> {
    const next = JSON.parse(validManifest(root));
    next.title = title;
    const proposed = (await call(client, "replace_manifest", { manifest: next })) as { proposal_id: string };
    await call(client, "apply_edit", { proposal_id: proposed.proposal_id });
  }

  it("prune_checkpoints keeps the newest N checkpoints and removes the rest", async () => {
    const root = freshProject();
    const client = await connect(root);
    for (const title of ["e1", "e2", "e3"]) await applyTitleEdit(client, root, title);
    expect(((await call(client, "list_checkpoints")) as { checkpoints: string[] }).checkpoints.length).toBe(3);

    const out = (await call(client, "prune_checkpoints", { keep: 1 })) as { ok: boolean; kept: number; removed: number };
    expect(out).toEqual({ ok: true, kept: 1, removed: 2 });
    expect(((await call(client, "list_checkpoints")) as { checkpoints: string[] }).checkpoints.length).toBe(1);
  });

  it("prune_checkpoints defaulting keep is a no-op below the cap", async () => {
    const root = freshProject();
    const client = await connect(root);
    await applyTitleEdit(client, root, "only");
    const out = (await call(client, "prune_checkpoints")) as { ok: boolean; kept: number; removed: number };
    expect(out).toEqual({ ok: true, kept: 1, removed: 0 });
  });

  it("staging a fresh proposal discards an earlier proposal made stale by an apply", async () => {
    const root = freshProject();
    const client = await connect(root);
    const a = JSON.parse(validManifest(root));
    a.title = "A";
    const propA = (await call(client, "replace_manifest", { manifest: a })) as { proposal_id: string };

    await applyTitleEdit(client, root, "applied"); // moves the base manifest, making propA stale

    const c = JSON.parse(validManifest(root));
    c.title = "C";
    await call(client, "replace_manifest", { manifest: c }); // staging C should sweep the stale propA

    const stale = (await call(client, "apply_edit", { proposal_id: propA.proposal_id })) as { ok: boolean; error: string };
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/unknown/i); // gone, not merely rejected as stale
  });
});

describe("result contract", () => {
  it("a list op returns an enveloped object, never a bare array", async () => {
    const client = await connect(freshProject());
    // listIslands now lives on `oi` (execute), but its envelope is unchanged: { ok, islands: [...] }.
    const islands = (await call(client, "list_islands")) as { ok: boolean; islands: unknown[] };
    expect(Array.isArray(islands)).toBe(false);
    expect(islands.ok).toBe(true);
    expect(Array.isArray(islands.islands)).toBe(true);
  });

  it("get_overview is concise by default and detailed on request", async () => {
    const client = await connect(freshProject());
    const concise = (await call(client, "get_overview")) as { ok: boolean; actions: { rowSchema?: unknown }[]; queries: unknown[] };
    expect(concise.ok).toBe(true);
    expect(concise.actions[0]!.rowSchema).toBeUndefined();
    const detailed = (await call(client, "get_overview", { verbosity: "detailed" })) as { actions: { rowSchema?: unknown }[] };
    expect(detailed.actions[0]!.rowSchema).toBeDefined();
  });

  it("run_sql reports an in-band ok:false error (not bare text) for conflicting args", async () => {
    const client = await connect(freshProject());
    const both = (await call(client, "run_sql", { dataset: "allocation", sql: "SELECT 1" })) as { ok: boolean; error: string };
    expect(both.ok).toBe(false);
    expect(both.error).toMatch(/either/i);
    const neither = (await call(client, "run_sql", {})) as { ok: boolean; error: string };
    expect(neither.ok).toBe(false);
  });

  it("run_sql caps a large result with a steering note, and verbosity:'detailed' widens the budget", async () => {
    const root = freshProject();
    const csvRows = Array.from({ length: 600 }, (_, i) => `${i},"${"x".repeat(120)}"`).join("\n");
    writeFileSync(join(root, "data", "wide.csv"), `id,blob\n${csvRows}\n`);
    const m = JSON.parse(validManifest(root));
    m.datasets.wide = { source: "data/wide.csv" };
    writeFileSync(join(root, "manifest.json"), JSON.stringify(m));
    const client = await connect(root);

    // The capped row sets are too big to return whole through execute's response cap, so the
    // program returns only each read's metadata — the row budget is enforced inside runSql, not by
    // the outer cap, and verbosity:"detailed" lifts it.
    const out = await runResult<{
      concise: { ok: boolean; rowCount: number; truncated?: boolean; note?: string };
      detailed: { rowCount: number; truncated?: boolean };
    }>(
      client,
      `const app = oi.app();
       const c = await app.runSql({ dataset: "wide", limit: 500 });
       const d = await app.runSql({ dataset: "wide", limit: 500, verbosity: "detailed" });
       return {
         concise: { ok: c.ok, rowCount: c.rowCount, truncated: c.truncated, note: c.note },
         detailed: { rowCount: d.rowCount, truncated: d.truncated },
       };`,
    );
    expect(out.concise.ok).toBe(true);
    expect(out.concise.truncated).toBe(true);
    expect(out.concise.rowCount).toBeLessThan(500);
    expect(out.concise.note).toMatch(/cap|narrow/i);
    expect(out.detailed.rowCount).toBeGreaterThan(out.concise.rowCount);
  });
});

describe("local-only telemetry", () => {
  const telemetryDir = (root: string) => join(root, ".openislands", "telemetry");

  it("a rejected stage appends a structured rejection record", async () => {
    const root = freshProject();
    const client = await connect(root);

    // Bind a page island to a column that doesn't exist — dryCheck rejects the stage.
    const staged = (await call(client, "patch_manifest", {
      pages: [{ id: "overview", title: "Overview", islands: [{ type: "metric.kpi", title: "Bad", dataset: "net_worth_monthly", value: "does_not_exist", format: "eur", span: 4 }] }],
    })) as { ok: boolean };
    expect(staged.ok).toBe(false);

    const log = readFileSync(join(telemetryDir(root), "rejections.jsonl"), "utf8").trim();
    const lines = log.split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as { ts: string; errors: { type?: string; message: string }[] };
    expect(typeof record.ts).toBe("string");
    expect(record.errors.length).toBeGreaterThan(0);
    expect(record.errors.every((e) => typeof e.message === "string")).toBe(true);
  });

  it("replaceManifest bumps the manifest-resend counter; patchManifest does not", async () => {
    const root = freshProject();
    const client = await connect(root);
    const counterPath = join(telemetryDir(root), "manifest_resends");

    expect(existsSync(counterPath)).toBe(false);

    const next = JSON.parse(validManifest(root));
    next.title = "Resent once";
    await call(client, "replace_manifest", { manifest: JSON.stringify(next) });
    expect(readFileSync(counterPath, "utf8")).toBe("1");

    next.title = "Resent twice";
    await call(client, "replace_manifest", { manifest: JSON.stringify(next) });
    expect(readFileSync(counterPath, "utf8")).toBe("2");

    // A section patch is the incremental path — it must not touch the resend counter.
    await call(client, "patch_manifest", { title: "Patched" });
    expect(readFileSync(counterPath, "utf8")).toBe("2");
  });
});
