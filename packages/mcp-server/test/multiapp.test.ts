/**
 * Multi-app workspace behavior for @openislands/mcp — the "multi-app by default" surface.
 *
 * createServer roots a WORKSPACE (a dir of `apps/<id>/manifest.json`). Since the pivot to pure
 * Code Mode there are NO native app/workspace tools — every operation is a method on `oi` inside
 * the single execute tool. These tests cover what server.test.ts's single-app fixture can't:
 *  - resolveApp via oi.app(id) inside execute (sole default, ambiguous error, explicit select,
 *    unknown error, invalid id, empty workspace) — a resolution failure surfaces as execute's
 *    thrown error,
 *  - the workspace surface: oi.createApp / oi.deleteApp / oi.listApps in execute,
 *  - the openislands://apps catalog + the per-app manifest resource template (still resources).
 *
 * Each test builds a self-contained workspace under a fresh mkdtemp and cleans its engines up.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetEngine } from "@openislands/compiler";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "finance");

/** App dirs (under `<workspace>/apps`) whose DuckDB engines must be reset between tests. */
const appDirs: string[] = [];

afterEach(() => {
  for (const dir of appDirs.splice(0)) resetEngine(dir);
});

/** A minimal valid manifest binding no data — enough for a second app to exist + validate. */
const noteManifest = (title: string): string =>
  JSON.stringify({
    version: 1,
    title,
    datasets: {},
    pages: [{ id: "overview", title: "Overview", islands: [{ type: "note.card", markdown: "hi", span: 12 }] }],
  });

/** Scaffold `apps/<id>/manifest.json` (a copy of the finance fixture, or a note manifest)
 * inside `root`, tracking the app dir for engine cleanup. */
function addApp(root: string, id: string, opts: { fromFixture?: boolean; title?: string } = {}): string {
  const dir = join(root, "apps", id);
  if (opts.fromFixture) {
    cpSync(FIXTURE, dir, { recursive: true });
  } else {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), noteManifest(opts.title ?? id));
  }
  appDirs.push(dir);
  return dir;
}

/** A workspace with the given app ids; the first is the finance fixture, the rest note apps. */
function workspace(ids: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "oi-mcp-ws-"));
  ids.forEach((id, i) => addApp(root, id, i === 0 ? { fromFixture: true } : { title: `${id} title` }));
  return root;
}

async function connect(root: string): Promise<Client> {
  const server = createServer(root);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "multiapp-test", version: "0" });
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

/** The execute envelope: { ok, result?, error? }. */
async function runCode<T = unknown>(client: Client, code: string): Promise<{ ok: boolean; result?: T; error?: string }> {
  return (await call(client, "execute", { code })) as { ok: boolean; result?: T; error?: string };
}

/** Run an `oi` program and return its `result`, asserting it succeeded — the only way to reach the
 * workspace/app methods (oi.listApps(), oi.app(id).runSql(...)) now that nothing is a native tool. */
async function runResult<T>(client: Client, code: string): Promise<T> {
  const out = await runCode<T>(client, code);
  expect(out.ok, out.error).toBe(true);
  return out.result as T;
}

/** Run an `oi` program expected to THROW (e.g. an app-resolution failure, which oi.app() raises),
 * returning execute's surfaced error string. */
async function runError(client: Client, code: string): Promise<string> {
  const out = await runCode(client, code);
  expect(out.ok, "expected the program to throw").toBe(false);
  return out.error ?? "";
}

describe("resolveApp — oi.app(id) inside execute", () => {
  it("omitting the id resolves to the sole app in a single-app workspace", async () => {
    const client = await connect(workspace(["finance"]));
    const ov = await runResult<{ ok: boolean; title: string }>(client, `return await oi.app().getOverview();`);
    expect(ov.ok).toBe(true);
    expect(ov.title).toBe("Finance Overview");
  });

  it("omitting the id in a multi-app workspace throws and names the available apps", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const error = await runError(client, `return await oi.app().getOverview();`);
    expect(error).toMatch(/multiple apps/i);
    expect(error).toContain("finance");
    expect(error).toContain("health");
  });

  it("an explicit id selects the right app's manifest", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const out = await runResult<{ finance: { ok: boolean; title: string }; health: { ok: boolean; title: string } }>(
      client,
      `
        const finance = await oi.app("finance").getOverview();
        const health = await oi.app("health").getOverview();
        return { finance, health };
      `,
    );
    expect(out.finance.ok).toBe(true);
    expect(out.finance.title).toBe("Finance Overview");
    expect(out.health.ok).toBe(true);
    expect(out.health.title).toBe("health title");
  });

  it("an unknown id throws and lists the available ids", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const error = await runError(client, `return await oi.app("ghost").getOverview();`);
    expect(error).toMatch(/unknown app 'ghost'/i);
    expect(error).toMatch(/finance/);
    expect(error).toMatch(/health/);
  });

  it("an empty workspace throws 'no apps found'", async () => {
    const client = await connect(mkdtempSync(join(tmpdir(), "oi-mcp-empty-")));
    const error = await runError(client, `return await oi.app().getOverview();`);
    expect(error).toMatch(/no apps found/i);
  });

  it("an invalid app id is rejected before lookup", async () => {
    const client = await connect(workspace(["finance"]));
    const error = await runError(client, `return await oi.app("../escape").getOverview();`);
    expect(error).toMatch(/invalid app id/i);
  });

  it("routes app-scoped reads to the right files", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const out = await runResult<{ finance: { ok: boolean; rows: { class: string }[] }; health: { ok: boolean } }>(
      client,
      `
        const finance = await oi.app("finance").runSql({ dataset: "allocation", limit: 5 });
        const health = await oi.app("health").runSql({ dataset: "allocation", limit: 5 });
        return { finance, health };
      `,
    );
    expect(out.finance.ok).toBe(true);
    expect(out.finance.rows.some((r) => r.class === "BTC")).toBe(true);
    // the health app has no such dataset — proves routing, not a shared engine
    expect(out.health.ok).toBe(false);
  });
});

describe("oi.listApps() — workspace listing via execute", () => {
  it("returns every app with its id, manifest title, and dir", async () => {
    const root = workspace(["finance", "health"]);
    const client = await connect(root);
    const { ok, apps } = await runResult<{ ok: boolean; apps: { id: string; title: string; dir: string }[] }>(client, `return await oi.listApps();`);
    expect(ok).toBe(true);
    const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
    expect(Object.keys(byId).toSorted()).toEqual(["finance", "health"]);
    expect(byId.finance!.title).toBe("Finance Overview");
    expect(byId.health!.title).toBe("health title");
    expect(byId.finance!.dir).toBe(join(root, "apps", "finance"));
  });

  it("returns an empty list for an empty workspace", async () => {
    const client = await connect(mkdtempSync(join(tmpdir(), "oi-mcp-empty-")));
    const { ok, apps } = await runResult<{ ok: boolean; apps: unknown[] }>(client, `return await oi.listApps();`);
    expect(ok).toBe(true);
    expect(apps).toEqual([]);
  });
});

describe("oi.createApp", () => {
  it("scaffolds an app that oi.listApps() then shows and oi.app(id) can target", async () => {
    const root = workspace(["finance"]);
    const client = await connect(root);

    const created = await runResult<{ ok: boolean; id: string; dir: string }>(client, `return await oi.createApp({ id: "ops", title: "Operations" });`);
    expect(created.ok).toBe(true);
    expect(created.id).toBe("ops");
    appDirs.push(created.dir);
    for (const sub of ["data", "models", "docs"]) expect(existsSync(join(created.dir, sub))).toBe(true);
    expect(existsSync(join(created.dir, "manifest.json"))).toBe(true);

    const { apps } = await runResult<{ apps: { id: string }[] }>(client, `return await oi.listApps();`);
    expect(apps.map((a) => a.id).toSorted()).toEqual(["finance", "ops"]);

    // the new app is now selectable; with 2 apps the program must name the id
    const ov = await runResult<{ ok: boolean; title: string }>(client, `return await oi.app("ops").getOverview();`);
    expect(ov.ok).toBe(true);
    expect(ov.title).toBe("Operations");
  });

  it("defaults the title to the id when none is given", async () => {
    const client = await connect(workspace(["finance"]));
    const created = await runResult<{ ok: boolean; dir: string }>(client, `return await oi.createApp({ id: "bare" });`);
    expect(created.ok).toBe(true);
    appDirs.push(created.dir);
    const ov = await runResult<{ title: string }>(client, `return await oi.app("bare").getOverview();`);
    expect(ov.title).toBe("bare");
  });

  it("rejects a duplicate create", async () => {
    const client = await connect(workspace(["finance"]));
    const dup = await runResult<{ ok: boolean; error: string }>(client, `return await oi.createApp({ id: "finance" });`);
    expect(dup.ok).toBe(false);
    expect(dup.error).toMatch(/already exists/i);
  });

  it("rejects an unsafe app id", async () => {
    const client = await connect(workspace(["finance"]));
    const bad = await runResult<{ ok: boolean; error: string }>(client, `return await oi.createApp({ id: "../evil" });`);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/invalid app id/i);
  });
});

describe("oi.deleteApp — reversible soft-archive", () => {
  it("moves the app into .openislands/trash and drops it from oi.listApps()", async () => {
    const root = workspace(["finance", "health"]);
    const client = await connect(root);

    const archived = await runResult<{ ok: boolean; archivedTo: string }>(client, `return await oi.deleteApp({ id: "health" });`);
    expect(archived.ok).toBe(true);
    expect(archived.archivedTo).toContain(join(".openislands", "trash"));

    // the app dir is gone but recoverable: a stamped dir exists under trash
    expect(existsSync(join(root, "apps", "health"))).toBe(false);
    expect(existsSync(archived.archivedTo)).toBe(true);
    const trashed = readdirSync(join(root, ".openislands", "trash"));
    expect(trashed.some((d) => d.startsWith("health-"))).toBe(true);

    const { apps } = await runResult<{ apps: { id: string }[] }>(client, `return await oi.listApps();`);
    expect(apps.map((a) => a.id)).toEqual(["finance"]);

    // with the sole remaining app, an unqualified oi.app() resolves again
    const ov = await runResult<{ ok: boolean; title: string }>(client, `return await oi.app().getOverview();`);
    expect(ov.ok).toBe(true);
    expect(ov.title).toBe("Finance Overview");
  });

  it("rejects deleting an unknown app", async () => {
    const client = await connect(workspace(["finance"]));
    const out = await runResult<{ ok: boolean; error: string }>(client, `return await oi.deleteApp({ id: "ghost" });`);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unknown app 'ghost'/i);
  });

  it("rejects an unsafe app id", async () => {
    const client = await connect(workspace(["finance"]));
    const out = await runResult<{ ok: boolean; error: string }>(client, `return await oi.deleteApp({ id: "../evil" });`);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/invalid app id/i);
  });
});

describe("resources — the app catalog + per-app manifests", () => {
  it("openislands://apps lists every app with id + title", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const res = await client.readResource({ uri: "openislands://apps" });
    const body = JSON.parse(res.contents[0]!.text as string) as { apps: { id: string; title: string }[] };
    const byId = Object.fromEntries(body.apps.map((a) => [a.id, a.title]));
    expect(Object.keys(byId).toSorted()).toEqual(["finance", "health"]);
    expect(byId.finance).toBe("Finance Overview");
    expect(byId.health).toBe("health title");
  });

  it("the apps resource is advertised by listResources", async () => {
    const client = await connect(workspace(["finance"]));
    const { resources } = await client.listResources();
    expect(resources.some((r) => r.uri === "openislands://apps")).toBe(true);
  });

  it("openislands://apps/<id>/manifest.json returns that app's manifest", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const res = await client.readResource({ uri: "openislands://apps/finance/manifest.json" });
    const manifest = JSON.parse(res.contents[0]!.text as string) as { title: string; datasets: Record<string, unknown> };
    expect(manifest.title).toBe("Finance Overview");
    expect(Object.keys(manifest.datasets).toSorted()).toEqual(["allocation", "net_worth_monthly", "notes"]);
  });

  it("the per-app manifest template lists one resource per app", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("openislands://apps/finance/manifest.json");
    expect(uris).toContain("openislands://apps/health/manifest.json");
  });

  it("reading an unknown app's manifest resource throws", async () => {
    const client = await connect(workspace(["finance"]));
    await expect(client.readResource({ uri: "openislands://apps/ghost/manifest.json" })).rejects.toThrow();
  });
});
