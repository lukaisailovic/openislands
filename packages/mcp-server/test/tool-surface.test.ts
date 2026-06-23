/**
 * Tool-surface guardrails for @openislands/mcp — deterministic, no AI, no network, no secrets.
 *
 * Ported from the retired `evals/run.ts` + `skills/mcp-evals` harness: same in-process MCP
 * client over InMemoryTransport, the same capability-aliased resolver and shape-agnostic
 * unwrap (so the checks survive a future tool rename), but as plain Vitest assertions that
 * run under `pnpm test` + CI instead of a report-writing CLI. Nothing here is shipped — `test/`
 * is stripped from the published `dist`.
 *
 * What it locks down:
 *  - BUDGET (the marquee guard): the whole tool-definition surface stays well under a token
 *    ceiling, and no single tool runs away. This catches the regression where patch_manifest
 *    inlined the island catalog through a typed inputSchema and ballooned the surface from
 *    ~4.9k to ~106k est. tokens — a cost every session pays just to learn the tools.
 *  - WALKTHROUGHS: each canonical agent task completes through the real pipeline within a
 *    bounded number of calls and response size.
 *  - CONTRACT: every result is an enveloped object carrying `ok` (except get_manifest's raw
 *    doc); every outputSchema tool returns matching structuredContent; list tools return
 *    { ok, <name>: [...] } rather than a bare array.
 *
 * Token cost is estimated at ~4 chars/token — approximate in absolute terms but identical
 * run-to-run, which is all a guardrail needs.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetCustomSchemaCache, resetEngine } from "@openislands/compiler";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "finance");

/** The workspace root that owns an app dir laid out as `<workspace>/apps/<id>`. */
const workspaceOf = (appDir: string): string => dirname(dirname(appDir));

/** Total tool-definition cost must stay well under this. Measured ~4.9k; the inlined-catalog
 * regression hit ~106k, so this ceiling sits far above today's surface yet far below the bloat. */
const TOOL_SURFACE_TOKEN_BUDGET = 15_000;
/** No single tool may run away. Measured fattest ~662 (patch_manifest); an inlined keystone
 * schema would blow past this on its own, before the total even matters. */
const MAX_SINGLE_TOOL_TOKENS = 2_500;

const estTokens = (chars: number): number => Math.ceil(chars / 4);

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) resetEngine(dir);
  resetCustomSchemaCache();
  delete process.env.DEMO_TOKEN;
});

/** A single-app workspace: the finance fixture lives at `<workspace>/apps/finance/`. The returned
 * value is that APP dir — path helpers join against it, and `connect` derives the workspace root.
 * With one app, every tool resolves it without an `app` arg, so the assertions stay unchanged. */
function freshFinance(): string {
  const workspace = mkdtempSync(join(tmpdir(), "oi-surface-"));
  const appDir = join(workspace, "apps", "finance");
  cpSync(FIXTURE, appDir, { recursive: true });
  roots.push(appDir);
  return appDir;
}

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

/** A single-app workspace with one unconnected connector — the root for the connect + sync walkthrough. */
function connectorProject(): string {
  const workspace = mkdtempSync(join(tmpdir(), "oi-surface-conn-"));
  const dir = join(workspace, "apps", "demo");
  mkdirSync(join(dir, "app"), { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  mkdirSync(join(dir, "connectors", "demo"), { recursive: true });
  const manifest = {
    version: 1,
    title: "Demo",
    datasets: { logs: { source: "data/logs.csv" } },
    pages: [{ id: "p", islands: [{ type: "note.card", markdown: "x" }] }],
    connectors: { demo: { module: "connectors/demo", datasets: { logs: "logs" }, config: { count: 2 } } },
  };
  writeFileSync(join(dir, "app", "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "connectors", "demo", "index.ts"), DEMO_CONNECTOR);
  roots.push(dir);
  return dir;
}

/** Connect a client to the workspace that owns `appDir`. */
async function connect(appDir: string): Promise<Client> {
  const server = createServer(workspaceOf(appDir));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tool-surface", version: "0" });
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  const body = res.content[0]!.text;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** Capability → the tool names that could serve it, newest first. The walkthroughs ask for a
 * capability and the session picks the first name the live server exposes, so a future rename
 * is a one-line ALIASES edit rather than a rewrite of every scripted task. */
const ALIASES: Record<string, string[]> = {
  orient: ["get_overview"],
  islandSchema: ["get_island_schema"],
  dataSchema: ["get_data_schema"],
  adhocRead: ["run_sql", "query_data"],
  validateManifest: ["validate_manifest"],
  stagePatch: ["patch_manifest"],
  stageFull: ["replace_manifest", "propose_edit"],
  apply: ["apply_edit"],
  listActions: ["list_actions"],
  runAction: ["run_action"],
  listQueries: ["list_queries"],
  runQuery: ["run_query"],
  listConnectors: ["list_connectors"],
  runSync: ["run_sync"],
};

/** Shape-agnostic: an enveloped `{ ok, <key>: [...] }` OR a bare value (pre-envelope). */
function unwrap<T = unknown>(res: unknown, key: string): T {
  if (Array.isArray(res)) return res as T;
  if (res && typeof res === "object" && key in (res as Record<string, unknown>)) return (res as Record<string, unknown>)[key] as T;
  return res as T;
}

const isOk = (res: unknown): boolean => !!res && typeof res === "object" && (res as { ok?: boolean }).ok !== false;

/** An in-process MCP client that resolves calls by capability and meters calls + response chars,
 * so a walkthrough reads as the scripted tool sequence an agent would run. */
interface Session {
  root: string;
  calls: number;
  chars: number;
  call(cap: string, args?: Record<string, unknown>): Promise<unknown>;
}

async function session(root: string): Promise<Session> {
  const client = await connect(root);
  const names = new Set((await client.listTools()).tools.map((t) => t.name));
  const resolve = (cap: string): string => {
    const candidates = ALIASES[cap] ?? [cap];
    const hit = candidates.find((n) => names.has(n));
    if (!hit) throw new Error(`no tool for capability '${cap}' (tried ${candidates.join(", ")})`);
    return hit;
  };
  const s: Session = {
    root,
    calls: 0,
    chars: 0,
    async call(cap, args = {}) {
      s.calls += 1;
      const res = (await client.callTool({ name: resolve(cap), arguments: args })) as { content?: { text?: string }[] };
      const txt = (res.content ?? []).map((c) => c.text ?? "").join("");
      s.chars += txt.length;
      try {
        return JSON.parse(txt);
      } catch {
        return txt;
      }
    },
  };
  return s;
}

/** Drive a scripted task, then assert it stayed within its call + response-token budget. The
 * steps assert success exactly; the budgets are documented ceilings (with headroom), not exact
 * counts, so honest churn doesn't flap the suite while a real regression still trips it. */
async function walkthrough(root: string, max: { calls: number; tokens: number }, steps: (s: Session) => Promise<void>): Promise<void> {
  const s = await session(root);
  await steps(s);
  expect(s.calls, "tool calls").toBeLessThanOrEqual(max.calls);
  expect(estTokens(s.chars), "response tokens").toBeLessThan(max.tokens);
}

describe("tool-definition budget", () => {
  it("the whole surface stays well under budget and no single tool runs away", async () => {
    const tools = (await (await connect(freshFinance())).listTools()).tools;
    const perTool = tools.map((t) => ({ name: t.name, tokens: estTokens(JSON.stringify(t).length) }));
    const total = perTool.reduce((sum, t) => sum + t.tokens, 0);
    const fattest = perTool.toSorted((a, b) => b.tokens - a.tokens)[0]!;

    expect(total, `${perTool.length} tools, ~${total} est. tokens; fattest ${fattest.name} (${fattest.tokens})`).toBeLessThan(TOOL_SURFACE_TOKEN_BUDGET);
    expect(fattest.tokens, `${fattest.name} is the fattest tool`).toBeLessThan(MAX_SINGLE_TOOL_TOKENS);
  });
});

describe("canonical task walkthroughs", () => {
  it("orient cold — one call yields a usable map", async () => {
    await walkthrough(freshFinance(), { calls: 1, tokens: 1000 }, async (s) => {
      const ov = (await s.call("orient")) as { pages?: unknown[] };
      expect(isOk(ov)).toBe(true);
      expect(unwrap(ov, "datasets")).toBeTruthy();
      expect(ov.pages).toBeTruthy();
    });
  });

  it("add a KPI — orient, ground, patch, apply", async () => {
    await walkthrough(freshFinance(), { calls: 4, tokens: 3200 }, async (s) => {
      const ov = (await s.call("orient")) as { pages: { id: string; title?: string; islands: unknown[] }[] };
      await s.call("islandSchema", { type: "metric.kpi" });
      const page = ov.pages[0]!;
      page.islands.push({ type: "metric.kpi", title: "Target", dataset: "net_worth_monthly", value: "target_eur", format: "eur", span: 4 });
      const staged = (await s.call("stagePatch", { pages: [page] })) as { proposal_id?: string };
      expect(isOk(staged)).toBe(true);
      expect(staged.proposal_id).toBeTruthy();
      expect(isOk(await s.call("apply", { proposal_id: staged.proposal_id }))).toBe(true);
    });
  });

  it("add a CSV + chart — bring a new file in and bind it", async () => {
    await walkthrough(freshFinance(), { calls: 3, tokens: 2500 }, async (s) => {
      writeFileSync(join(s.root, "data", "crypto.csv"), "coin,amount_eur\nBTC,50000\nETH,20000\n");
      await s.call("orient");
      const staged = (await s.call("stagePatch", {
        datasets: { crypto: { source: "data/crypto.csv", description: "holdings" } },
        pages: [{ id: "crypto", title: "Crypto", islands: [{ type: "rank.list", title: "By coin", dataset: "crypto", label: "coin", value: "amount_eur", span: 12 }] }],
      })) as { proposal_id?: string };
      expect(isOk(staged)).toBe(true);
      expect(staged.proposal_id).toBeTruthy();
      expect(isOk(await s.call("apply", { proposal_id: staged.proposal_id }))).toBe(true);
    });
  });

  it("author + run a query — declare a typed read and run it", async () => {
    await walkthrough(freshFinance(), { calls: 5, tokens: 2800 }, async (s) => {
      await s.call("orient");
      const staged = (await s.call("stagePatch", {
        queries: { by_class: { dataset: "allocation", select: ["class", "value_eur"], params: { class: { type: "string" } }, where: [{ field: "class", op: "eq", param: "class" }] } },
      })) as { proposal_id?: string };
      expect(isOk(staged)).toBe(true);
      expect(staged.proposal_id).toBeTruthy();
      expect(isOk(await s.call("apply", { proposal_id: staged.proposal_id }))).toBe(true);
      await s.call("listQueries");
      const ran = (await s.call("runQuery", { name: "by_class", params: { class: "BTC" } })) as { rows?: { class: string }[] };
      expect(isOk(ran)).toBe(true);
      expect(ran.rows?.[0]?.class).toBe("BTC");
    });
  });

  it("log a row — discover the action and append through it", async () => {
    await walkthrough(freshFinance(), { calls: 3, tokens: 1300 }, async (s) => {
      await s.call("orient");
      await s.call("listActions");
      const out = (await s.call("runAction", { name: "log_allocation", rows: [{ class: "Stocks", value_eur: 250000 }] })) as { inserted?: number };
      expect(isOk(out)).toBe(true);
      expect(out.inserted).toBe(1);
    });
  });

  it("fix a binding error — validate surfaces it, then patch the real column", async () => {
    const root = freshFinance();
    const m = JSON.parse(readFileSync(join(root, "app", "manifest.json"), "utf8"));
    m.pages[0].islands[0].value = "does_not_exist";
    writeFileSync(join(root, "app", "manifest.json"), JSON.stringify(m, null, 2));

    await walkthrough(root, { calls: 4, tokens: 900 }, async (s) => {
      const v = await s.call("validateManifest");
      expect(isOk(v), "the binding error must surface, not pass").toBe(false);
      await s.call("dataSchema", { dataset: "net_worth_monthly" });
      const staged = (await s.call("stagePatch", {
        pages: [
          {
            id: "overview",
            title: "Overview",
            islands: [
              { type: "metric.kpi", title: "Net worth", dataset: "net_worth_monthly", value: "net_worth_eur", compareTo: "prev", format: "eur", span: 4 },
              { type: "timeseries.line", title: "Net worth over time", dataset: "net_worth_monthly", x: "month", y: "net_worth_eur", options: { goalField: "target_eur" }, span: 8 },
              { type: "breakdown.treemap", title: "Allocation", dataset: "allocation", label: "class", value: "value_eur", span: 12 },
            ],
          },
        ],
      })) as { proposal_id?: string };
      expect(isOk(staged)).toBe(true);
      expect(staged.proposal_id).toBeTruthy();
      expect(isOk(await s.call("apply", { proposal_id: staged.proposal_id }))).toBe(true);
    });
  });

  it("connect + sync — discover a connector and pull its rows", async () => {
    process.env.DEMO_TOKEN = "t";
    await walkthrough(connectorProject(), { calls: 2, tokens: 400 }, async (s) => {
      await s.call("listConnectors");
      expect(isOk(await s.call("runSync", { name: "demo" }))).toBe(true);
    });
  });
});

/** A valid manifest that stages clean against the finance fixture (allocation.csv exists,
 * note.card binds no data) — the smoke-call payload for the staging tools. */
const PROBE_MANIFEST = {
  version: 1,
  title: "Probe",
  datasets: { allocation: { source: "data/allocation.csv" } },
  pages: [{ id: "p", islands: [{ type: "note.card", markdown: "x", span: 12 }] }],
};

/** Minimal valid arguments to reach each tool's handler (past SDK input validation) so its
 * envelope can be inspected. ok:false is fine — these probe the contract, not success. Adding
 * or renaming a tool must add an entry here; the contract test fails loudly until it does. */
const MINIMAL_ARGS: Record<string, Record<string, unknown>> = {
  get_overview: {},
  list_islands: {},
  get_island_schema: { type: "metric.kpi" },
  get_manifest: {},
  get_data_schema: { dataset: "allocation" },
  run_sql: { dataset: "allocation" },
  validate_sql: { sql: "SELECT class FROM allocation" },
  validate_manifest: {},
  list_checkpoints: {},
  prune_checkpoints: {},
  replace_manifest: { manifest: PROBE_MANIFEST },
  patch_manifest: { title: "Surface probe" },
  apply_edit: { proposal_id: "prop-unknownunknownun" },
  rollback: {},
  list_actions: {},
  run_action: { name: "nonexistent", rows: [{ x: 1 }] },
  list_queries: {},
  run_query: { name: "nonexistent" },
  list_connectors: {},
  run_sync: { name: "nonexistent" },
  list_apps: {},
  create_app: { id: "surface-probe-app" },
  delete_app: { id: "nonexistent" },
};

/** List tools and the array key each must envelope (never a bare array). */
const LIST_TOOLS: Record<string, string> = {
  list_islands: "islands",
  list_actions: "actions",
  list_queries: "queries",
  list_connectors: "connectors",
  list_checkpoints: "checkpoints",
  list_apps: "apps",
};

describe("result contract", () => {
  it("every tool returns an enveloped object carrying `ok` (except get_manifest's raw doc)", async () => {
    const root = freshFinance();
    const client = await connect(root);
    const liveNames = (await client.listTools()).tools.map((t) => t.name);

    const uncovered = liveNames.filter((n) => !(n in MINIMAL_ARGS));
    expect(uncovered, `tools missing a MINIMAL_ARGS smoke-call entry: ${uncovered.join(", ")}`).toEqual([]);

    for (const name of liveNames) {
      const body = (await call(client, name, MINIMAL_ARGS[name]!)) as Record<string, unknown>;
      expect(typeof body, name).toBe("object");
      if (name === "get_manifest") {
        // The lone exception: the raw manifest document, returned verbatim with no envelope.
        expect("ok" in body, "get_manifest is the raw doc").toBe(false);
        expect(body).toEqual(JSON.parse(readFileSync(join(root, "app", "manifest.json"), "utf8")));
        continue;
      }
      expect("ok" in body, name).toBe(true);
      expect(typeof body.ok, name).toBe("boolean");
    }
  });

  it("every outputSchema tool returns structuredContent that mirrors its text", async () => {
    const client = await connect(freshFinance());
    const structuredTools = (await client.listTools()).tools.filter((t) => t.outputSchema);
    // Non-vacuous: the high-value reads + proposal tools all declare an outputSchema.
    expect(structuredTools.length).toBeGreaterThanOrEqual(8);

    for (const t of structuredTools) {
      const res = (await client.callTool({ name: t.name, arguments: MINIMAL_ARGS[t.name]! })) as {
        content: { text: string }[];
        structuredContent?: Record<string, unknown>;
      };
      expect(res.structuredContent, t.name).toBeDefined();
      expect(typeof res.structuredContent!.ok, t.name).toBe("boolean");
      expect(JSON.parse(res.content[0]!.text), t.name).toEqual(res.structuredContent);
    }
  });

  it("list tools envelope their array as { ok, <name>: [...] } — never a bare array", async () => {
    const client = await connect(freshFinance());
    for (const [name, key] of Object.entries(LIST_TOOLS)) {
      const res = await call(client, name);
      expect(Array.isArray(res), `${name} must not return a bare array`).toBe(false);
      const obj = res as Record<string, unknown>;
      expect(obj.ok, name).toBe(true);
      expect(Array.isArray(obj[key]), `${name}.${key}`).toBe(true);
    }
  });
});

const validManifest = (root: string): string => readFileSync(join(root, "app", "manifest.json"), "utf8");

describe("extended walkthroughs", () => {
  it("apply → rollback restores the manifest byte-for-byte", async () => {
    const root = freshFinance();
    const client = await connect(root);
    const original = validManifest(root);

    const staged = (await call(client, "patch_manifest", { title: "Renamed" })) as { ok: boolean; proposal_id: string };
    expect(staged.ok).toBe(true);
    expect(isOk(await call(client, "apply_edit", { proposal_id: staged.proposal_id }))).toBe(true);
    expect(validManifest(root)).not.toBe(original);

    const back = (await call(client, "rollback")) as { ok: boolean };
    expect(back.ok).toBe(true);
    expect(validManifest(root)).toBe(original);
  });

  it("patch_manifest deletes a section entry with null", async () => {
    const root = freshFinance();
    const client = await connect(root);
    expect(JSON.parse(validManifest(root)).actions.log_allocation).toBeDefined();

    const staged = (await call(client, "patch_manifest", { actions: { log_allocation: null } })) as { ok: boolean; proposal_id: string };
    expect(staged.ok).toBe(true);
    expect(isOk(await call(client, "apply_edit", { proposal_id: staged.proposal_id }))).toBe(true);
    expect(JSON.parse(validManifest(root)).actions).toBeUndefined();
  });

  it("apply_edit rejects a proposal made stale by an intervening apply", async () => {
    const root = freshFinance();
    const client = await connect(root);

    const a = JSON.parse(validManifest(root));
    a.title = "A";
    const propA = (await call(client, "replace_manifest", { manifest: a })) as { proposal_id: string };

    const b = JSON.parse(validManifest(root));
    b.title = "B";
    const propB = (await call(client, "replace_manifest", { manifest: b })) as { proposal_id: string };
    expect(isOk(await call(client, "apply_edit", { proposal_id: propB.proposal_id }))).toBe(true);

    const stale = (await call(client, "apply_edit", { proposal_id: propA.proposal_id })) as { ok: boolean; error: string };
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/stale/i);
  });

  it("validate_sql dry-runs an authored SELECT and rejects a non-SELECT", async () => {
    const client = await connect(freshFinance());
    const authored = (await call(client, "validate_sql", { sql: "SELECT class, SUM(value_eur) AS total FROM allocation GROUP BY class" })) as { ok: boolean; columns?: { name: string }[] };
    expect(authored.ok).toBe(true);
    expect(authored.columns!.map((c) => c.name).toSorted()).toEqual(["class", "total"]);

    const rejected = (await call(client, "validate_sql", { sql: "DROP TABLE allocation" })) as { ok: boolean; error?: string };
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/read-only|SELECT/i);
  });

  it("binds a custom island once its schema exists, and rejects a config that breaks it", async () => {
    const root = freshFinance();
    const dir = join(root, "components", "custom", "gauge.ring");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "schema.ts"),
      `import { z } from "zod";\nexport default z.object({\n  type: z.literal("gauge.ring"),\n  dataset: z.string(),\n  rings: z.array(z.object({ value: z.string(), max: z.union([z.string(), z.number()]) })).min(1),\n});\n`,
    );
    const client = await connect(root);
    const withRings = (rings: unknown): string => {
      const m = JSON.parse(validManifest(root));
      m.pages[0].islands = [{ type: "gauge.ring", title: "Rings", dataset: "allocation", rings }];
      return JSON.stringify(m);
    };

    const bad = (await call(client, "replace_manifest", { manifest: withRings([{ max: "value_eur" }]) })) as { ok: boolean; proposal_id?: string; errors: { type: string; page: string; index: number }[] };
    expect(bad.ok).toBe(false);
    expect(bad.proposal_id).toBeUndefined();
    expect(bad.errors.find((e) => e.type === "gauge.ring")).toMatchObject({ page: "overview", index: 0 });

    const good = (await call(client, "replace_manifest", { manifest: withRings([{ value: "value_eur", max: "value_eur" }]) })) as { ok: boolean; proposal_id?: string };
    expect(good.ok).toBe(true);
    expect(good.proposal_id).toBeTruthy();
    expect(isOk(await call(client, "apply_edit", { proposal_id: good.proposal_id }))).toBe(true);
  });
});
