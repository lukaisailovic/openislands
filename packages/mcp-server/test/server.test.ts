import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function freshProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-mcp-"));
  cpSync(FIXTURE, dir, { recursive: true });
  roots.push(dir);
  return dir;
}

async function connect(root: string): Promise<Client> {
  const server = createServer(root);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[] };
  const body = res.content[0]!.text;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

const validManifest = (root: string) => readFileSync(join(root, "app", "manifest.json"), "utf8");

describe("read tools", () => {
  it("list_islands returns contracts with required fields", async () => {
    const client = await connect(freshProject());
    const islands = (await call(client, "list_islands")) as { type: string; required: string[] }[];
    const kpi = islands.find((i) => i.type === "metric.kpi");
    expect(kpi?.required).toEqual(["dataset", "value"]);
    const note = islands.find((i) => i.type === "note.card");
    expect(note?.required).toEqual(["markdown"]);
  });

  it("query_data reads a dataset", async () => {
    const client = await connect(freshProject());
    const rows = (await call(client, "query_data", { dataset: "net_worth_monthly", limit: 2 })) as unknown[];
    expect(rows.length).toBe(2);
  });

  it("query_data runs a read-only SQL SELECT over the views", async () => {
    const client = await connect(freshProject());
    const rows = (await call(client, "query_data", { sql: "SELECT class, value_eur FROM allocation ORDER BY value_eur DESC", limit: 1 })) as { class: string }[];
    expect(rows[0]!.class).toBe("BTC");
  });

  it("query_data rejects non-SELECT SQL", async () => {
    const client = await connect(freshProject());
    const out = await call(client, "query_data", { sql: "DROP TABLE allocation" });
    expect(String(out)).toMatch(/read-only|failed/i);
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
    const proposed = (await call(client, "propose_edit", { manifest: next })) as { proposal_id: string };
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
    writeFileSync(join(root, "app", "manifest.json"), JSON.stringify(m));
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
    const proposed = (await call(client, "propose_edit", { manifest: JSON.stringify(next) })) as { ok: boolean; proposal_id: string };
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
    const rejected = (await call(client, "propose_edit", { manifest: JSON.stringify(bad) })) as { ok: boolean; errors: unknown[] };
    expect(rejected.ok).toBe(false);
    expect(rejected.errors.length).toBeGreaterThan(0);

    const good = JSON.parse(validManifest(root));
    good.title = "Fixed";
    const ok = (await call(client, "propose_edit", { manifest: JSON.stringify(good) })) as { ok: boolean; proposal_id: string };
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
    const proposed = (await call(client, "propose_edit", { manifest: JSON.stringify(next) })) as { proposal_id: string };
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
    const proposed = (await call(client, "propose_edit", { manifest: JSON.stringify(next) })) as { proposal_id: string };
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
    const propA = (await call(client, "propose_edit", { manifest: JSON.stringify(a) })) as { proposal_id: string };

    const b = JSON.parse(validManifest(root));
    b.title = "B";
    const propB = (await call(client, "propose_edit", { manifest: JSON.stringify(b) })) as { proposal_id: string };
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
    const proposed = (await call(client1, "propose_edit", { manifest: JSON.stringify(next) })) as { proposal_id: string };

    const client2 = await connect(root);
    const applied = (await call(client2, "apply_edit", { proposal_id: proposed.proposal_id })) as { ok: boolean };
    expect(applied.ok).toBe(true);
    const checkpoints = (await call(client2, "list_checkpoints")) as string[];
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
    const proposed = (await call(client, "propose_edit", { manifest: JSON.stringify(grouped) })) as { ok: boolean; proposal_id: string };
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
    const out = (await call(client, "propose_edit", { manifest: JSON.stringify(grouped) })) as {
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
    const rows = (await call(client, "query_data", { dataset: "notes" })) as { note: string }[];
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
      const out = (await call(client, "propose_edit", { manifest: JSON.stringify(m) })) as { ok: boolean };
      expect(out.ok, evil).toBe(false);
    }
  });
});

const allocationCsv = (root: string) => readFileSync(join(root, "data", "allocation.csv"), "utf8");

describe("data actions", () => {
  it("list_actions returns the declared action with a row schema naming the CSV columns", async () => {
    const client = await connect(freshProject());
    const actions = (await call(client, "list_actions")) as { name: string; dataset: string; mode: string; rowSchema: { properties: Record<string, unknown> } }[];
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
    writeFileSync(join(root, "app", "manifest.json"), JSON.stringify(m));
    const client = await connect(root);
    const actions = (await call(client, "list_actions")) as unknown[];
    expect(actions).toEqual([]);
  });

  it("run_action inserts a valid row that query_data then sees", async () => {
    const root = freshProject();
    const client = await connect(root);
    const before = allocationCsv(root);

    const out = (await call(client, "run_action", { name: "log_allocation", rows: [{ class: "Stocks", value_eur: 250000 }] })) as { ok: boolean; inserted: number; checkpoint_id: string };
    expect(out.ok).toBe(true);
    expect(out.inserted).toBe(1);
    expect(out.checkpoint_id).toMatch(/^ckpt-\d+!/);
    expect(allocationCsv(root).length).toBeGreaterThan(before.length);

    const rows = (await call(client, "query_data", { dataset: "allocation" })) as { class: string; value_eur: number }[];
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
    const proposed = (await call(client, "propose_edit", { manifest: JSON.stringify(next) })) as { proposal_id: string };
    await call(client, "apply_edit", { proposal_id: proposed.proposal_id });

    await call(client, "run_action", { name: "log_allocation", rows: [{ class: "Cash", value_eur: 5 }] });

    const checkpoints = (await call(client, "list_checkpoints")) as string[];
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
    writeFileSync(join(root, "app", "manifest.json"), JSON.stringify(m));
    const client2 = await connect(root);

    const written = (await call(client2, "run_action", { name: "log_note", rows: [{ id: 9, note: payload }] })) as { ok: boolean };
    expect(written.ok).toBe(true);

    expect(readFileSync(join(root, "data", "net_worth_monthly.csv"), "utf8")).toBe(otherBefore);
    const rows = (await call(client2, "query_data", { dataset: "notes" })) as { id: number; note: string }[];
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

describe("read queries", () => {
  function withQuery(root: string, queries: Record<string, unknown>): string {
    const m = JSON.parse(validManifest(root));
    m.queries = queries;
    writeFileSync(join(root, "app", "manifest.json"), JSON.stringify(m));
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
    const queries = (await call(client, "list_queries")) as {
      name: string;
      description?: string;
      params: { properties?: Record<string, unknown>; required?: string[] };
      columns: { name: string }[];
    }[];
    expect(queries).toHaveLength(1);
    const q = queries[0]!;
    expect(q.name).toBe("alloc_by_class");
    expect(Object.keys(q.params.properties ?? {})).toEqual(["class"]);
    expect(q.columns.map((c) => c.name)).toEqual(["class", "value_eur"]);
  });

  it("list_queries returns an empty list when none are declared", async () => {
    const client = await connect(freshProject());
    expect(await call(client, "list_queries")).toEqual([]);
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

  it("an agent can author a query end-to-end via propose_edit → apply_edit", async () => {
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
    const proposed = (await call(client, "propose_edit", { manifest: JSON.stringify(next) })) as { ok: boolean; proposal_id?: string; errors?: unknown[] };
    expect(proposed.ok, JSON.stringify(proposed.errors)).toBe(true);
    expect(proposed.proposal_id).toBeTruthy();

    const applied = (await call(client, "apply_edit", { proposal_id: proposed.proposal_id! })) as { ok: boolean };
    expect(applied.ok).toBe(true);

    const listed = (await call(client, "list_queries")) as { name: string }[];
    expect(listed.some((q) => q.name === "alloc_by_class")).toBe(true);

    const ran = (await call(client, "run_query", { name: "alloc_by_class", params: { class: "ETH" } })) as { ok: boolean; rows: { class: string; value_eur: number }[] };
    expect(ran.ok).toBe(true);
    expect(ran.rows[0]!.class).toBe("ETH");
  });

  it("propose_edit rejects a query whose field is not a column (checkQueries runs in dryCheck)", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.queries = { broken: { dataset: "allocation", where: [{ field: "ghost_col", op: "eq", value: 1 }] } };
    const out = (await call(client, "propose_edit", { manifest: JSON.stringify(next) })) as { ok: boolean; proposal_id?: string; errors: string[] };
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
  const dir = mkdtempSync(join(tmpdir(), "oi-mcp-conn-"));
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

describe("connectors", () => {
  afterEach(() => {
    delete process.env.DEMO_TOKEN;
  });

  it("list_connectors reports an unconnected connector with its missing secret", async () => {
    const client = await connect(connectorProject());
    const statuses = (await call(client, "list_connectors")) as { name: string; auth: string; connected: boolean; missingSecrets: string[]; schedule?: string }[];
    const demo = statuses.find((s) => s.name === "demo")!;
    expect(demo.auth).toBe("none");
    expect(demo.connected).toBe(false);
    expect(demo.missingSecrets).toContain("DEMO_TOKEN");
    expect(demo.schedule).toBe("6h");
  });

  it("run_sync pulls rows into the dataset that query_data then sees", async () => {
    process.env.DEMO_TOKEN = "t";
    const client = await connect(connectorProject());
    const result = (await call(client, "run_sync", { name: "demo" })) as { connector: string; datasets: Record<string, { mode: string; rows: number; checkpoint_id?: string }> };
    expect(result.connector).toBe("demo");
    expect(result.datasets.logs!.mode).toBe("insert");
    expect(result.datasets.logs!.rows).toBe(2);

    const rows = (await call(client, "query_data", { dataset: "logs" })) as unknown[];
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

describe("custom island schema enforcement (propose_edit)", () => {
  it("rejects a bad gauge.ring config naming the page/index/type/field", async () => {
    const root = freshProject();
    withGaugeSchema(root);
    const client = await connect(root);
    const out = (await call(client, "propose_edit", {
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
    const out = (await call(client, "propose_edit", {
      manifest: gaugeManifest(root, [{ value: "value_eur", max: "value_eur" }]),
    })) as { ok: boolean; proposal_id?: string };
    expect(out.ok).toBe(true);
    expect(out.proposal_id).toBeDefined();
  });
});

describe("page filter bind enforcement (propose_edit)", () => {
  it("rejects a filter bound to a missing column with a structured error", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.pages[0].filters = [{ id: "period", type: "daterange", bind: { net_worth_monthly: "ghost" } }];
    const out = (await call(client, "propose_edit", { manifest: JSON.stringify(next) })) as {
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
    const out = (await call(client, "propose_edit", { manifest: JSON.stringify(next) })) as { ok: boolean; proposal_id?: string };
    expect(out.ok).toBe(true);
    expect(out.proposal_id).toBeDefined();
  });
});

describe("M7 catalog additions are discoverable + bindable", () => {
  it("list_islands includes the new island types with their required fields", async () => {
    const client = await connect(freshProject());
    const islands = (await call(client, "list_islands")) as { type: string; required: string[] }[];
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
    const proposed = (await call(client, "propose_edit", { manifest: JSON.stringify(next) })) as { ok: boolean; proposal_id: string };
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
    const out = (await call(client, "propose_edit", { manifest: JSON.stringify(next) })) as {
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

describe("propose_edit accepts a manifest object", () => {
  it("takes a JSON object directly (no double-encoding) and applies it", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.title = "Object edit";
    const proposed = (await call(client, "propose_edit", { manifest: next })) as { ok: boolean; proposal_id?: string; errors?: unknown[] };
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
    const row = (await call(client, "get_island_schema", { type: "layout.row" })) as {
      type: string;
      schema: unknown;
      layout: null;
      notes: string[];
    };
    expect(row.type).toBe("layout.row");
    expect(row.schema).toBeDefined();
    expect(row.layout).toBeNull();
    expect(row.notes[0]).toMatch(/full-width row/i);
  });

  it("list_islands carries the span range for each island", async () => {
    const client = await connect(freshProject());
    const islands = (await call(client, "list_islands")) as { type: string; minSpan?: number; recommendedSpan?: number; maxSpan?: number }[];
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

  it("propose_edit surfaces a lone-kpi warning but still stages (ok:true)", async () => {
    const root = freshProject();
    const client = await connect(root);
    const next = JSON.parse(validManifest(root));
    next.title = "Edited";
    const out = (await call(client, "propose_edit", { manifest: next })) as { ok: boolean; proposal_id?: string; warnings: { type: string }[] };
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
    const proposed = (await call(client, "propose_edit", { manifest: next })) as { proposal_id: string };
    await call(client, "apply_edit", { proposal_id: proposed.proposal_id });
  }

  it("cleanup_history keeps the newest N checkpoints and removes the rest", async () => {
    const root = freshProject();
    const client = await connect(root);
    for (const title of ["e1", "e2", "e3"]) await applyTitleEdit(client, root, title);
    expect(((await call(client, "list_checkpoints")) as string[]).length).toBe(3);

    const out = (await call(client, "cleanup_history", { keep: 1 })) as { ok: boolean; kept: number; removed: number };
    expect(out).toEqual({ ok: true, kept: 1, removed: 2 });
    expect(((await call(client, "list_checkpoints")) as string[]).length).toBe(1);
  });

  it("cleanup_history defaulting keep is a no-op below the cap", async () => {
    const root = freshProject();
    const client = await connect(root);
    await applyTitleEdit(client, root, "only");
    const out = (await call(client, "cleanup_history")) as { ok: boolean; kept: number; removed: number };
    expect(out).toEqual({ ok: true, kept: 1, removed: 0 });
  });

  it("staging a fresh proposal discards an earlier proposal made stale by an apply", async () => {
    const root = freshProject();
    const client = await connect(root);
    const a = JSON.parse(validManifest(root));
    a.title = "A";
    const propA = (await call(client, "propose_edit", { manifest: a })) as { proposal_id: string };

    await applyTitleEdit(client, root, "applied"); // moves the base manifest, making propA stale

    const c = JSON.parse(validManifest(root));
    c.title = "C";
    await call(client, "propose_edit", { manifest: c }); // staging C should sweep the stale propA

    const stale = (await call(client, "apply_edit", { proposal_id: propA.proposal_id })) as { ok: boolean; error: string };
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/unknown/i); // gone, not merely rejected as stale
  });
});
