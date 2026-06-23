/**
 * Multi-app workspace behavior for @openislands/mcp — the "multi-app by default" surface.
 *
 * createServer roots a WORKSPACE (a dir of `apps/<id>/app/manifest.json`), and every app-scoped
 * tool takes an optional `app`. These tests cover what server.test.ts's single-app fixture can't:
 *  - resolveApp via tool calls (sole default, ambiguous error, explicit select, unknown error),
 *  - the project-level tools list_apps / create_app / delete_app,
 *  - the openislands://apps catalog + the per-app manifest resource template.
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

/** Scaffold `apps/<id>/app/manifest.json` (a copy of the finance fixture, or a note manifest)
 * inside `root`, tracking the app dir for engine cleanup. */
function addApp(root: string, id: string, opts: { fromFixture?: boolean; title?: string } = {}): string {
  const dir = join(root, "apps", id);
  if (opts.fromFixture) {
    cpSync(FIXTURE, dir, { recursive: true });
  } else {
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app", "manifest.json"), noteManifest(opts.title ?? id));
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

describe("resolveApp — the optional app selector", () => {
  it("omitting app resolves to the sole app in a single-app workspace", async () => {
    const client = await connect(workspace(["finance"]));
    const ov = (await call(client, "get_overview")) as { ok: boolean; title: string };
    expect(ov.ok).toBe(true);
    expect(ov.title).toBe("Finance Overview");
  });

  it("omitting app in a multi-app workspace errors and names the available apps", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const ov = (await call(client, "get_overview")) as { ok: boolean; error: string };
    expect(ov.ok).toBe(false);
    expect(ov.error).toMatch(/multiple apps/i);
    expect(ov.error).toContain("finance");
    expect(ov.error).toContain("health");
  });

  it("an explicit app selects the right app's manifest", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const finance = (await call(client, "get_overview", { app: "finance" })) as { ok: boolean; title: string };
    expect(finance.ok).toBe(true);
    expect(finance.title).toBe("Finance Overview");
    const health = (await call(client, "get_overview", { app: "health" })) as { ok: boolean; title: string };
    expect(health.ok).toBe(true);
    expect(health.title).toBe("health title");
  });

  it("an unknown app errors and lists the available ids", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const ov = (await call(client, "get_overview", { app: "ghost" })) as { ok: boolean; error: string };
    expect(ov.ok).toBe(false);
    expect(ov.error).toMatch(/unknown app 'ghost'/i);
    expect(ov.error).toMatch(/finance/);
    expect(ov.error).toMatch(/health/);
  });

  it("an empty workspace errors with 'no apps found'", async () => {
    const client = await connect(mkdtempSync(join(tmpdir(), "oi-mcp-empty-")));
    const ov = (await call(client, "get_overview")) as { ok: boolean; error: string };
    expect(ov.ok).toBe(false);
    expect(ov.error).toMatch(/no apps found/i);
  });

  it("an invalid app id is rejected before lookup", async () => {
    const client = await connect(workspace(["finance"]));
    const ov = (await call(client, "get_overview", { app: "../escape" })) as { ok: boolean; error: string };
    expect(ov.ok).toBe(false);
    expect(ov.error).toMatch(/invalid app id/i);
  });

  it("the explicit app routes app-scoped reads to the right files (run_sql)", async () => {
    const client = await connect(workspace(["finance", "health"]));
    const ran = (await call(client, "run_sql", { app: "finance", dataset: "allocation", limit: 5 })) as { ok: boolean; rows: { class: string }[] };
    expect(ran.ok).toBe(true);
    expect(ran.rows.some((r) => r.class === "BTC")).toBe(true);
    // the health app has no such dataset — proves routing, not a shared engine
    const missing = (await call(client, "run_sql", { app: "health", dataset: "allocation", limit: 5 })) as { ok: boolean; error: string };
    expect(missing.ok).toBe(false);
  });
});

describe("list_apps", () => {
  it("returns every app with its id, manifest title, and dir", async () => {
    const root = workspace(["finance", "health"]);
    const client = await connect(root);
    const { ok, apps } = (await call(client, "list_apps")) as { ok: boolean; apps: { id: string; title: string; dir: string }[] };
    expect(ok).toBe(true);
    const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
    expect(Object.keys(byId).toSorted()).toEqual(["finance", "health"]);
    expect(byId.finance!.title).toBe("Finance Overview");
    expect(byId.health!.title).toBe("health title");
    expect(byId.finance!.dir).toBe(join(root, "apps", "finance"));
  });

  it("returns an empty list for an empty workspace", async () => {
    const client = await connect(mkdtempSync(join(tmpdir(), "oi-mcp-empty-")));
    const { ok, apps } = (await call(client, "list_apps")) as { ok: boolean; apps: unknown[] };
    expect(ok).toBe(true);
    expect(apps).toEqual([]);
  });
});

describe("create_app", () => {
  it("scaffolds an app that list_apps then shows and tools can target by app", async () => {
    const root = workspace(["finance"]);
    const client = await connect(root);

    const created = (await call(client, "create_app", { id: "ops", title: "Operations" })) as { ok: boolean; id: string; dir: string };
    expect(created.ok).toBe(true);
    expect(created.id).toBe("ops");
    appDirs.push(created.dir);
    for (const sub of ["app", "data", "models", "docs"]) expect(existsSync(join(created.dir, sub))).toBe(true);
    expect(existsSync(join(created.dir, "app", "manifest.json"))).toBe(true);

    const { apps } = (await call(client, "list_apps")) as { apps: { id: string }[] };
    expect(apps.map((a) => a.id).toSorted()).toEqual(["finance", "ops"]);

    // the new app is now selectable; with 2 apps the call must carry `app`
    const ov = (await call(client, "get_overview", { app: "ops" })) as { ok: boolean; title: string };
    expect(ov.ok).toBe(true);
    expect(ov.title).toBe("Operations");
  });

  it("defaults the title to the id when none is given", async () => {
    const client = await connect(workspace(["finance"]));
    const created = (await call(client, "create_app", { id: "bare" })) as { ok: boolean; dir: string };
    expect(created.ok).toBe(true);
    appDirs.push(created.dir);
    const ov = (await call(client, "get_overview", { app: "bare" })) as { ok: boolean; title: string };
    expect(ov.title).toBe("bare");
  });

  it("rejects a duplicate create_app", async () => {
    const client = await connect(workspace(["finance"]));
    const dup = (await call(client, "create_app", { id: "finance" })) as { ok: boolean; error: string };
    expect(dup.ok).toBe(false);
    expect(dup.error).toMatch(/already exists/i);
  });

  it("rejects an unsafe app id", async () => {
    const client = await connect(workspace(["finance"]));
    const bad = (await call(client, "create_app", { id: "../evil" })) as { ok: boolean; error: string };
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/invalid app id/i);
  });
});

describe("delete_app — reversible soft-archive", () => {
  it("moves the app into .openislands/trash and drops it from list_apps", async () => {
    const root = workspace(["finance", "health"]);
    const client = await connect(root);

    const archived = (await call(client, "delete_app", { id: "health" })) as { ok: boolean; archivedTo: string };
    expect(archived.ok).toBe(true);
    expect(archived.archivedTo).toContain(join(".openislands", "trash"));

    // the app dir is gone but recoverable: a stamped dir exists under trash
    expect(existsSync(join(root, "apps", "health"))).toBe(false);
    expect(existsSync(archived.archivedTo)).toBe(true);
    const trashed = readdirSync(join(root, ".openislands", "trash"));
    expect(trashed.some((d) => d.startsWith("health-"))).toBe(true);

    const { apps } = (await call(client, "list_apps")) as { apps: { id: string }[] };
    expect(apps.map((a) => a.id)).toEqual(["finance"]);

    // with the sole remaining app, an unqualified tool call resolves again
    const ov = (await call(client, "get_overview")) as { ok: boolean; title: string };
    expect(ov.ok).toBe(true);
    expect(ov.title).toBe("Finance Overview");
  });

  it("rejects deleting an unknown app", async () => {
    const client = await connect(workspace(["finance"]));
    const out = (await call(client, "delete_app", { id: "ghost" })) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unknown app 'ghost'/i);
  });

  it("rejects an unsafe app id", async () => {
    const client = await connect(workspace(["finance"]));
    const out = (await call(client, "delete_app", { id: "../evil" })) as { ok: boolean; error: string };
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
