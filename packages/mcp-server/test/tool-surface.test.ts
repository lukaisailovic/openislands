/**
 * Tool-surface guardrails for @openislands/mcp — deterministic, no AI, no network, no secrets.
 *
 * Same in-process MCP client over InMemoryTransport, the finance fixture, and the connector
 * helper as before, but the surface is now PURE Code Mode: exactly ONE tool — `execute` — with
 * every operation reachable only as a method on `oi` inside it. The canonical agent tasks that
 * used to be one-tool-per-step are now single `execute` programs. Nothing here is shipped —
 * `test/` is stripped from the published `dist`.
 *
 * What it locks down:
 *  - SURFACE: listTools() is exactly [execute] — no atomic tools remain (the two read-only
 *    resources live alongside it but aren't tools).
 *  - BUDGET (the marquee guard): execute is the only/fattest tool (its description embeds the `oi`
 *    TS API, ~2.3k est. tokens) and stays under both the per-tool and the total ceiling.
 *  - WALKTHROUGHS: each canonical agent task completes inside ONE execute call (orient; add a
 *    KPI; add a CSV + chart; author + run a query; log a row; fix a binding error; connect + sync).
 *  - CONTRACT: execute returns an enveloped { ok, …, logs } object; a response that returns a huge
 *    dump is truncated (the response cap, not just the defs).
 *  - PARITY: the method names on `oi.app()` match the AppApi interface documented in server.ts —
 *    neither has a name the other lacks (a doc the agent programs against can't silently drift).
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

/** The exact Code Mode tool surface — execute, nothing else. */
const EXPECTED_TOOLS = ["execute"];

/** Total tool-definition cost must stay well under this. The pre-Code-Mode surface was ~4.9k and
 * a regression once hit ~106k; this ceiling sits far above today's surface yet far below that bloat. */
const TOOL_SURFACE_TOKEN_BUDGET = 15_000;
/** No single tool may run away. execute is the fattest (it embeds the `oi` TS API in its
 * description); it must still clear this ceiling. */
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

/** Call a tool and parse its JSON text body (the server's `json(...)` envelope). */
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  const body = res.content[0]!.text;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** The shape `execute` always returns: { ok, result?, logs, error?, … }. */
interface RunCodeBody {
  ok: boolean;
  result?: unknown;
  logs: string[];
  error?: string;
  result_truncated?: boolean;
  logs_truncated?: boolean;
  checkpoints_created?: string[];
}

/** Run an `oi` program through the execute tool and return its parsed envelope + the response
 * char count (for the response-size budget — the def budget can't see what a script returns). */
async function runCode(client: Client, code: string): Promise<{ body: RunCodeBody; chars: number }> {
  const res = (await client.callTool({ name: "execute", arguments: { code } })) as { content: { text: string }[] };
  const text = res.content[0]!.text;
  return { body: JSON.parse(text) as RunCodeBody, chars: text.length };
}

describe("tool-definition surface + budget", () => {
  it("registers exactly one tool: execute", async () => {
    const tools = (await (await connect(freshFinance())).listTools()).tools;
    expect(tools).toHaveLength(1);
    expect(tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
  });

  it("the whole surface stays well under budget and the single tool doesn't run away", async () => {
    const tools = (await (await connect(freshFinance())).listTools()).tools;
    const perTool = tools.map((t) => ({ name: t.name, tokens: estTokens(JSON.stringify(t).length) }));
    const total = perTool.reduce((sum, t) => sum + t.tokens, 0);
    const fattest = perTool.toSorted((a, b) => b.tokens - a.tokens)[0]!;

    expect(total, `${perTool.length} tools, ~${total} est. tokens; fattest ${fattest.name} (${fattest.tokens})`).toBeLessThan(TOOL_SURFACE_TOKEN_BUDGET);
    // execute is the only tool, and it carries the embedded `oi` API, so it is the fattest by design.
    expect(fattest.name, "execute is the only tool").toBe("execute");
    expect(fattest.tokens, `${fattest.name} is the fattest tool`).toBeLessThan(MAX_SINGLE_TOOL_TOKENS);
  });
});

describe("canonical task walkthroughs — one execute program each", () => {
  it("orient cold — one program yields a usable map", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      const ov = await oi.app().getOverview();
      return { ok: ov.ok, title: ov.title, datasets: Object.keys(ov.datasets), pages: ov.pages.length };
    `);
    expect(body.ok).toBe(true);
    const r = body.result as { ok: boolean; title: string; datasets: string[]; pages: number };
    expect(r.ok).toBe(true);
    expect(r.title).toBe("Finance Overview");
    expect(r.datasets.toSorted()).toEqual(["allocation", "net_worth_monthly", "notes"]);
    expect(r.pages).toBe(1);
  });

  it("add a KPI — orient, ground, patch, apply, all in one program", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      const app = oi.app();
      const ov = await app.getOverview();
      const schema = await app.getIslandSchema("metric.kpi");
      if (!schema.ok) return { failed: "schema" };
      const page = ov.pages[0];
      page.islands.push({ type: "metric.kpi", title: "Target", dataset: "net_worth_monthly", value: "target_eur", format: "eur", span: 4 });
      const staged = await app.patchManifest({ pages: [page] });
      if (!staged.ok) return { failed: "stage", errors: staged.errors };
      const applied = await app.applyEdit(staged.proposal_id);
      return { stagedOk: staged.ok, appliedOk: applied.ok };
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ stagedOk: true, appliedOk: true });
    expect(body.checkpoints_created?.length).toBe(1);
  });

  it("add a CSV + chart — bring a new file in and bind it in one program", async () => {
    const root = freshFinance();
    writeFileSync(join(root, "data", "crypto.csv"), "coin,amount_eur\nBTC,50000\nETH,20000\n");
    const { body } = await runCode(await connect(root), `
      const app = oi.app();
      const staged = await app.patchManifest({
        datasets: { crypto: { source: "data/crypto.csv", description: "holdings" } },
        pages: [{ id: "crypto", title: "Crypto", islands: [{ type: "rank.list", title: "By coin", dataset: "crypto", label: "coin", value: "amount_eur", span: 12 }] }],
      });
      if (!staged.ok) return { failed: "stage", errors: staged.errors };
      return await app.applyEdit(staged.proposal_id);
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(join(root, "app", "manifest.json"), "utf8")).datasets.crypto.source).toBe("data/crypto.csv");
  });

  it("author + run a query — declare a typed read and run it in one program", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      const app = oi.app();
      const staged = await app.patchManifest({
        queries: { by_class: { dataset: "allocation", select: ["class", "value_eur"], params: { class: { type: "string" } }, where: [{ field: "class", op: "eq", param: "class" }] } },
      });
      if (!staged.ok) return { failed: "stage", errors: staged.errors };
      const applied = await app.applyEdit(staged.proposal_id);
      const ran = await app.runQuery("by_class", { class: "BTC" });
      return { appliedOk: applied.ok, firstClass: ran.rows[0]?.class };
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ appliedOk: true, firstClass: "BTC" });
  });

  it("log a row — discover the action and append through it in one program", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      const app = oi.app();
      const { actions } = await app.listActions();
      const out = await app.runAction("log_allocation", [{ class: "Stocks", value_eur: 250000 }]);
      return { hasAction: actions.some((a) => a.name === "log_allocation"), ok: out.ok, inserted: out.inserted };
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ hasAction: true, ok: true, inserted: 1 });
    expect(body.checkpoints_created?.length).toBe(1);
  });

  it("fix a binding error — validate surfaces it, then patch the real column in one program", async () => {
    const root = freshFinance();
    const m = JSON.parse(readFileSync(join(root, "app", "manifest.json"), "utf8"));
    m.pages[0].islands[0].value = "does_not_exist";
    writeFileSync(join(root, "app", "manifest.json"), JSON.stringify(m, null, 2));

    const { body } = await runCode(await connect(root), `
      const app = oi.app();
      const before = await app.validateManifest();
      const schema = await app.getDataSchema("net_worth_monthly");
      const staged = await app.patchManifest({
        pages: [{
          id: "overview",
          title: "Overview",
          islands: [
            { type: "metric.kpi", title: "Net worth", dataset: "net_worth_monthly", value: "net_worth_eur", compareTo: "prev", format: "eur", span: 4 },
            { type: "timeseries.line", title: "Net worth over time", dataset: "net_worth_monthly", x: "month", y: "net_worth_eur", options: { goalField: "target_eur" }, span: 8 },
            { type: "breakdown.treemap", title: "Allocation", dataset: "allocation", label: "class", value: "value_eur", span: 12 },
          ],
        }],
      });
      if (!staged.ok) return { failed: "stage", errors: staged.errors };
      const applied = await app.applyEdit(staged.proposal_id);
      return { brokenSurfaced: before.ok === false, hasColumn: schema.columns.some((c) => c.name === "net_worth_eur"), appliedOk: applied.ok };
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ brokenSurfaced: true, hasColumn: true, appliedOk: true });
  });

  it("connect + sync — discover a connector and pull its rows in one program", async () => {
    process.env.DEMO_TOKEN = "t";
    const { body } = await runCode(await connect(connectorProject()), `
      const app = oi.app();
      const { connectors } = await app.listConnectors();
      const synced = await app.runSync("demo");
      const read = await app.runSql({ dataset: "logs" });
      return { discovered: connectors.some((c) => c.name === "demo"), syncedOk: synced.ok, rowCount: read.rowCount };
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ discovered: true, syncedOk: true, rowCount: 2 });
  });
});

describe("execute composition + safety", () => {
  it("composes orient + a per-dataset SELECT loop in one call", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      const app = oi.app();
      const ov = await app.getOverview();
      const counts = {};
      for (const name of Object.keys(ov.datasets)) counts[name] = (await app.runSql({ dataset: name, limit: 1 })).rowCount;
      return counts;
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ net_worth_monthly: 1, allocation: 1, notes: 1 });
  });

  it("serializes a DuckDB BigInt count to a number rather than crashing", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      return await oi.app().runSql({ sql: "SELECT count(*) AS n FROM allocation" });
    `);
    expect(body.ok).toBe(true);
    expect((body.result as { rows: { n: number }[] }).rows).toEqual([{ n: 3 }]);
  });

  it("stage → apply → rollback in one script reports checkpoints and restores the title", async () => {
    const root = freshFinance();
    const { body } = await runCode(await connect(root), `
      const app = oi.app();
      const ov = await app.getOverview();
      const original = ov.title;
      const staged = await app.patchManifest({ title: "Renamed in script" });
      const applied = await app.applyEdit(staged.proposal_id);
      const afterApply = (await app.getOverview()).title;
      const back = await app.rollback(applied.checkpoint_id);
      const afterRollback = (await app.getOverview()).title;
      return { original, afterApply, restored: back.ok, afterRollback };
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ original: "Finance Overview", afterApply: "Renamed in script", restored: true, afterRollback: "Finance Overview" });
    // The applyEdit checkpoint is reported; the rollback restores it, leaving the file as it began.
    expect(body.checkpoints_created?.length).toBe(1);
    expect(readFileSync(join(root, "app", "manifest.json"), "utf8")).toBe(readFileSync(join(FIXTURE, "app", "manifest.json"), "utf8"));
  });

  it("a write then a read in the same script sees the new row (the engine resets on the dirty bit)", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      const app = oi.app();
      const before = (await app.runSql({ dataset: "allocation" })).rowCount;
      await app.runAction("log_allocation", [{ class: "Stocks", value_eur: 250000 }]);
      const after = (await app.runSql({ dataset: "allocation" })).rowCount;
      return { before, after };
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ before: 3, after: 4 });
  });

  it("reading the same dataset twice without an intervening write reuses the engine (no error)", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      const app = oi.app();
      const a = (await app.runSql({ dataset: "allocation" })).rowCount;
      const b = (await app.runSql({ dataset: "allocation" })).rowCount;
      return { a, b };
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ a: 3, b: 3 });
  });

  it("the sandbox hides process/require and survives the textbook break-out", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      const reachable = (() => { try { return this.constructor.constructor("return process")(); } catch { return null; } })();
      return { process: typeof process, require: typeof require, reachedHost: reachable !== null };
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ process: "undefined", require: "undefined", reachedHost: false });
  });

  it("surfaces a thrown error as { ok:false, error } without leaking host paths", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      await oi.app().getOverview();
      throw new Error("script blew up");
    `);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/script blew up/);
    expect(body.error).not.toMatch(/api\.js|server\.js|node_modules|node:internal/);
  });
});

describe("result contract", () => {
  it("execute always returns an enveloped { ok, logs } object", async () => {
    const client = await connect(freshFinance());

    const ok = (await call(client, "execute", { code: `return await oi.app().getOverview();` })) as RunCodeBody;
    expect(typeof ok).toBe("object");
    expect(ok.ok).toBe(true);
    expect(Array.isArray(ok.logs)).toBe(true);

    // A thrown program still envelopes: ok:false with an error string and the logs array.
    const failed = (await call(client, "execute", { code: `throw new Error("nope");` })) as RunCodeBody;
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/nope/);
    expect(Array.isArray(failed.logs)).toBe(true);
  });

  it("a execute program returning a huge dump is truncated in the response", async () => {
    // The tool-def budget can't see this — only the response cap can. A 10k-row dump blows past
    // execute's default maxResultChars (~60k) and must come back as a flagged string.
    const { body } = await runCode(await connect(freshFinance()), `
      return Array.from({ length: 10000 }, (_, i) => ({ i, blob: "x".repeat(40) }));
    `);
    expect(body.ok).toBe(true);
    expect(body.result_truncated).toBe(true);
    expect(typeof body.result).toBe("string");
    expect((body.result as string)).toMatch(/truncated/i);
  });

  it("oi.app().getOverview() is concise by default and detailed on request", async () => {
    const { body } = await runCode(await connect(freshFinance()), `
      const app = oi.app();
      const concise = await app.getOverview();
      const detailed = await app.getOverview({ verbosity: "detailed" });
      return {
        conciseOk: concise.ok,
        conciseHasRowSchema: concise.actions[0]?.rowSchema !== undefined,
        detailedHasRowSchema: detailed.actions[0]?.rowSchema !== undefined,
      };
    `);
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ conciseOk: true, conciseHasRowSchema: false, detailedHasRowSchema: true });
  });
});

/** Extract the method names declared in the `interface AppApi { … }` block of OI_API_DECL inside
 * server.ts. Each method is a `name(` at the start of a trimmed line; comment + blank lines are
 * skipped. This is the doc the agent programs against, so it must match the real object exactly. */
function documentedApiMethods(): string[] {
  const src = readFileSync(join(import.meta.dirname, "..", "src", "server.ts"), "utf8");
  const block = src.match(/interface AppApi \{([\s\S]*?)\n\}/);
  if (!block) throw new Error("could not find the AppApi interface in server.ts");
  const names = new Set<string>();
  for (const line of block[1]!.split("\n")) {
    const m = line.trim().match(/^([a-zA-Z]\w*)\s*\(/);
    if (m) names.add(m[1]!);
  }
  return [...names].toSorted();
}

/** Build the real `oi.app()` object (single-app workspace) and list its method names. */
async function appApiMethods(): Promise<string[]> {
  const { body } = await runCode(await connect(freshFinance()), `return Object.keys(oi.app()).sort();`);
  return body.result as string[];
}

describe("api / doc parity", () => {
  it("oi.app() method names match the AppApi interface documented in server.ts", async () => {
    const documented = documentedApiMethods();
    const actual = await appApiMethods();
    expect(documented.length, "the parity check must see a non-trivial interface").toBeGreaterThan(10);
    // Symmetric: neither the live object nor the embedded doc may carry a method the other lacks.
    expect(actual, "methods documented but missing from oi.app()").toEqual(expect.arrayContaining(documented));
    expect(documented, "methods on oi.app() but undocumented in OI_API_DECL").toEqual(expect.arrayContaining(actual));
    expect(actual).toEqual(documented);
  });
});
