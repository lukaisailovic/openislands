/**
 * Local dev eval for the @openislands/mcp tool surface — NOT shipped (the package only
 * publishes `dist`) and NOT in CI. Measures two things an agent actually pays for:
 *
 *   1. Tool-definition token cost — what every session spends just to learn the tools
 *      (sum of name + title + description + input/output schema + annotations).
 *   2. Per-task tool-calls + response tokens — the recurring cost of doing real work,
 *      over a fixed set of canonical tasks run as scripted in-process tool sequences.
 *
 * It resolves tools by *capability* (e.g. "ad-hoc read") against the live `listTools()`,
 * so the identical harness runs against the old names (baseline) and the renamed surface
 * (after) — and unwraps results shape-agnostically so the envelope change is transparent.
 *
 * Run:  node_modules/.bin/tsx packages/mcp-server/evals/run.ts <label>
 * Baseline-vs-after: capture `baseline` on `main`, then `after` on the branch — a second
 * label diffs against results/baseline.json automatically. Tokens are estimated at
 * ~4 chars/token; the estimate is identical on both sides, so the deltas are honest.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetEngine } from "@openislands/compiler";
import { createServer } from "../src/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "test", "fixtures", "finance");
const RESULTS = join(HERE, "results");

const estTokens = (chars: number): number => Math.ceil(chars / 4);
const signed = (delta: number): string => `${delta >= 0 ? "+" : ""}${delta}`;

/** Capability → the tool names that could serve it, newest first. The harness picks the
 * first that the connected server actually exposes, so it tracks renames without edits. */
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

type ToolDef = { name: string; title?: string; description?: string; inputSchema?: unknown; outputSchema?: unknown; annotations?: unknown };

async function connect(root: string): Promise<Client> {
  const server = createServer(root);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "eval", version: "0" });
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return client;
}

function freshFinance(): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-eval-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const DEMO_CONNECTOR = `import { defineConnector } from "@openislands/connector-kit";
import { z } from "zod";
export default defineConnector({
  description: "Deterministic eval connector",
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
  const dir = mkdtempSync(join(tmpdir(), "oi-eval-conn-"));
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
  return dir;
}

/** Shape-agnostic: an enveloped `{ ok, <key>: [...] }` OR a bare array (pre-envelope). */
function unwrap<T = unknown>(res: unknown, key: string): T {
  if (Array.isArray(res)) return res as T;
  if (res && typeof res === "object" && key in (res as Record<string, unknown>)) return (res as Record<string, unknown>)[key] as T;
  return res as T;
}
const isOk = (res: unknown): boolean => !!res && typeof res === "object" && (res as { ok?: boolean }).ok !== false;

interface ScenarioResult {
  name: string;
  calls: number;
  responseTokens: number;
  ok: boolean;
  note?: string;
}

async function scenario(name: string, makeRoot: () => string, steps: (api: { call: (cap: string, args?: Record<string, unknown>) => Promise<unknown>; root: string }) => Promise<boolean>): Promise<ScenarioResult> {
  const root = makeRoot();
  let calls = 0;
  let chars = 0;
  let ok = false;
  let note: string | undefined;
  try {
    const client = await connect(root);
    const names = new Set((await client.listTools()).tools.map((t) => t.name));
    const resolve = (cap: string): string => {
      const hit = (ALIASES[cap] ?? [cap]).find((n) => names.has(n));
      if (!hit) throw new Error(`no tool for capability '${cap}' (tried ${(ALIASES[cap] ?? [cap]).join(", ")})`);
      return hit;
    };
    const call = async (cap: string, args: Record<string, unknown> = {}): Promise<unknown> => {
      calls += 1;
      const res = (await client.callTool({ name: resolve(cap), arguments: args })) as { content?: { text?: string }[] };
      const text = (res.content ?? []).map((c) => c.text ?? "").join("");
      chars += text.length;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    };
    ok = await steps({ call, root });
  } catch (e) {
    note = (e as Error).message;
  } finally {
    resetEngine(root);
  }
  return { name, calls, responseTokens: estTokens(chars), ok, note };
}

async function toolDefinitionCost(): Promise<{ tools: number; tokens: number; perTool: { name: string; tokens: number }[] }> {
  const root = freshFinance();
  const client = await connect(root);
  const tools = (await client.listTools()).tools as ToolDef[];
  const perTool = tools
    .map((t) => ({ name: t.name, tokens: estTokens(JSON.stringify(t).length) }))
    .toSorted((a, b) => b.tokens - a.tokens);
  resetEngine(root);
  return { tools: tools.length, tokens: perTool.reduce((s, t) => s + t.tokens, 0), perTool };
}

const SCENARIOS = [
  () =>
    scenario("orient cold", freshFinance, async ({ call }) => {
      const ov = await call("orient");
      return isOk(ov) && !!unwrap<Record<string, unknown>>(ov, "datasets");
    }),

  () =>
    scenario("add a KPI", freshFinance, async ({ call }) => {
      const ov = (await call("orient")) as { pages: { id: string; title?: string; islands: unknown[] }[] };
      await call("islandSchema", { type: "metric.kpi" });
      const page = ov.pages[0]!;
      page.islands.push({ type: "metric.kpi", title: "Target", dataset: "net_worth_monthly", value: "target_eur", format: "eur", span: 4 });
      const staged = (await call("stagePatch", { pages: [page] })) as { proposal_id?: string };
      if (!staged.proposal_id) return false;
      return isOk(await call("apply", { proposal_id: staged.proposal_id }));
    }),

  () =>
    scenario("add a CSV + chart", freshFinance, async ({ call, root }) => {
      writeFileSync(join(root, "data", "crypto.csv"), "coin,amount_eur\nBTC,50000\nETH,20000\n");
      await call("orient");
      const staged = (await call("stagePatch", {
        datasets: { crypto: { source: "data/crypto.csv", description: "holdings" } },
        pages: [{ id: "crypto", title: "Crypto", islands: [{ type: "rank.list", title: "By coin", dataset: "crypto", label: "coin", value: "amount_eur", span: 12 }] }],
      })) as { proposal_id?: string };
      if (!staged.proposal_id) return false;
      return isOk(await call("apply", { proposal_id: staged.proposal_id }));
    }),

  () =>
    scenario("author + run a query", freshFinance, async ({ call }) => {
      await call("orient");
      const staged = (await call("stagePatch", {
        queries: { by_class: { dataset: "allocation", select: ["class", "value_eur"], params: { class: { type: "string" } }, where: [{ field: "class", op: "eq", param: "class" }] } },
      })) as { proposal_id?: string };
      if (!staged.proposal_id) return false;
      if (!isOk(await call("apply", { proposal_id: staged.proposal_id }))) return false;
      await call("listQueries");
      const ran = await call("runQuery", { name: "by_class", params: { class: "BTC" } });
      return isOk(ran);
    }),

  () =>
    scenario("log a row", freshFinance, async ({ call }) => {
      await call("orient");
      await call("listActions");
      const out = await call("runAction", { name: "log_allocation", rows: [{ class: "Stocks", value_eur: 250000 }] });
      return isOk(out);
    }),

  () =>
    scenario("fix a binding error", () => {
      const dir = freshFinance();
      const m = JSON.parse(readFileSync(join(dir, "app", "manifest.json"), "utf8"));
      m.pages[0].islands[0].value = "does_not_exist";
      writeFileSync(join(dir, "app", "manifest.json"), JSON.stringify(m, null, 2));
      return dir;
    }, async ({ call }) => {
      const v = await call("validateManifest");
      if (isOk(v)) return false; // the binding error must surface
      await call("dataSchema", { dataset: "net_worth_monthly" }); // find the real column
      const staged = (await call("stagePatch", {
        pages: [{ id: "overview", title: "Overview", islands: [
          { type: "metric.kpi", title: "Net worth", dataset: "net_worth_monthly", value: "net_worth_eur", compareTo: "prev", format: "eur", span: 4 },
          { type: "timeseries.line", title: "Net worth over time", dataset: "net_worth_monthly", x: "month", y: "net_worth_eur", options: { goalField: "target_eur" }, span: 8 },
          { type: "breakdown.treemap", title: "Allocation", dataset: "allocation", label: "class", value: "value_eur", span: 12 },
        ] }],
      })) as { proposal_id?: string };
      if (!staged.proposal_id) return false;
      return isOk(await call("apply", { proposal_id: staged.proposal_id }));
    }),

  () =>
    scenario("connect + sync", connectorProject, async ({ call }) => {
      process.env.DEMO_TOKEN = "t";
      try {
        await call("listConnectors");
        return isOk(await call("runSync", { name: "demo" }));
      } finally {
        delete process.env.DEMO_TOKEN;
      }
    }),
];

async function main(): Promise<void> {
  const label = (process.argv[2] ?? "current").replace(/[^a-z0-9_-]/gi, "_");
  const defs = await toolDefinitionCost();
  const scenarios: ScenarioResult[] = [];
  for (const s of SCENARIOS) scenarios.push(await s());

  const totalCalls = scenarios.reduce((s, r) => s + r.calls, 0);
  const totalResp = scenarios.reduce((s, r) => s + r.responseTokens, 0);
  const passed = scenarios.filter((r) => r.ok).length;
  const report = { label, definitions: defs, scenarios, totals: { calls: totalCalls, responseTokens: totalResp, passed, of: scenarios.length } };

  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `${label}.json`), JSON.stringify(report, null, 2) + "\n");

  console.log(`\n# MCP eval — ${label}\n`);
  console.log(`Tool definitions: ${defs.tools} tools, ~${defs.tokens} tokens`);
  console.log(`Top 5 by definition cost: ${defs.perTool.slice(0, 5).map((t) => `${t.name} (${t.tokens})`).join(", ")}\n`);
  console.log(`| Task | tool-calls | response tokens | ok |`);
  console.log(`| --- | ---: | ---: | :-: |`);
  for (const r of scenarios) console.log(`| ${r.name} | ${r.calls} | ${r.responseTokens} | ${r.ok ? "✓" : "✗" + (r.note ? ` (${r.note})` : "")} |`);
  console.log(`| **total** | **${totalCalls}** | **${totalResp}** | **${passed}/${scenarios.length}** |`);

  const baselinePath = join(RESULTS, "baseline.json");
  if (label !== "baseline" && existsSync(baselinePath)) {
    const base = JSON.parse(readFileSync(baselinePath, "utf8")) as typeof report;
    console.log(`\n## Δ vs baseline`);
    console.log(`- tool-definition tokens: ${base.definitions.tokens} → ${defs.tokens} (${signed(defs.tokens - base.definitions.tokens)})`);
    console.log(`- total tool-calls: ${base.totals.calls} → ${totalCalls} (${signed(totalCalls - base.totals.calls)})`);
    console.log(`- total response tokens: ${base.totals.responseTokens} → ${totalResp} (${signed(totalResp - base.totals.responseTokens)})`);
    console.log(`- tasks passing: ${base.totals.passed}/${base.totals.of} → ${passed}/${scenarios.length}`);
  }
  console.log("");
}

await main();
