import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  listConnectorStatuses,
  runConnectorSync,
  getConnectorAuthorizeUrl,
  completeConnectorOAuth,
  disconnectConnector,
  checkConnectors,
  query,
  resetEngine,
  resetConnectorCache,
  readManifest,
} from "../src/index.js";

const projects: string[] = [];
afterEach(() => {
  for (const dir of projects.splice(0)) resetEngine(dir);
  resetConnectorCache();
  delete process.env.DEMO_TOKEN;
  delete process.env.DEMO_CLIENT_ID;
  delete process.env.DEMO_CLIENT_SECRET;
  delete process.env.DEMO_BEARER;
});

const DEMO_CONNECTOR = `
import { defineConnector } from "@openislands/connector-kit";
import { z } from "zod";

export default defineConnector({
  description: "Deterministic test connector",
  config: z.object({ count: z.number().default(2) }),
  secrets: ["DEMO_TOKEN"],
  schedule: "6h",
  outputs: { logs: { description: "appended events" }, snapshot: { description: "replaced snapshot" } },
  async sync(ctx) {
    const seen = typeof ctx.state.seen === "number" ? ctx.state.seen : 0;
    const count = ctx.config.count;
    const logs = [];
    for (let i = 0; i < count; i += 1) logs.push({ id: seen + i, label: "event-" + (seen + i) });
    await ctx.insert("logs", logs);
    await ctx.replace("snapshot", [{ total: seen + count }]);
    ctx.state.seen = seen + count;
  },
});
`;

const OAUTH_CONNECTOR = (authorizeUrl: string, tokenUrl: string) => `
import { defineConnector } from "@openislands/connector-kit";

export default defineConnector({
  auth: {
    type: "oauth2",
    data: {
      authorizeUrl: ${JSON.stringify(authorizeUrl)},
      tokenUrl: ${JSON.stringify(tokenUrl)},
      scopes: ["read:all"],
      clientIdEnv: "DEMO_CLIENT_ID",
      clientSecretEnv: "DEMO_CLIENT_SECRET",
    },
  },
  outputs: { logs: {} },
  async sync(ctx) {
    await ctx.insert("logs", [{ token: ctx.tokens.accessToken }]);
  },
});
`;

const BEARER_CONNECTOR = `
import { defineConnector } from "@openislands/connector-kit";

export default defineConnector({
  auth: { type: "bearer", data: { tokenEnv: "DEMO_BEARER" } },
  outputs: { logs: {} },
  async sync(ctx) {
    await ctx.insert("logs", [{ token: ctx.tokens.accessToken }]);
  },
});
`;

function demoManifest(extra?: Record<string, unknown>) {
  return {
    version: 1,
    title: "Demo",
    datasets: {
      logs: { source: "data/logs.csv" },
      snapshot: { source: "data/snapshot.json" },
    },
    pages: [{ id: "p", islands: [{ type: "note.card", markdown: "x" }] }],
    connectors: {
      demo: {
        module: "connectors/demo",
        datasets: { logs: "logs", snapshot: "snapshot" },
        config: { count: 2 },
        ...extra,
      },
    },
  };
}

function project(manifest: unknown, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "oi-conn-"));
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  mkdirSync(join(dir, "connectors", "demo"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  projects.push(dir);
  return dir;
}

describe("module loading errors", () => {
  it("reports a missing module directory", async () => {
    const m = demoManifest();
    m.connectors.demo.module = "connectors/ghost";
    const dir = project(m, {});
    const errors = await checkConnectors(dir, await readManifest(dir));
    expect(errors.some((e) => /not found/.test(e.message))).toBe(true);
  });

  it("reports a directory with no index file", async () => {
    const dir = project(demoManifest(), {});
    const errors = await checkConnectors(dir, await readManifest(dir));
    expect(errors.some((e) => /no index/.test(e.message))).toBe(true);
  });

  it("reports a bundle error", async () => {
    const dir = project(demoManifest(), { "connectors/demo/index.ts": "this is not valid typescript ((" });
    const errors = await checkConnectors(dir, await readManifest(dir));
    expect(errors.some((e) => /bundle/.test(e.message))).toBe(true);
  });
});

describe("connector validation", () => {
  it("rejects a config that fails the connector's schema", async () => {
    const m = demoManifest();
    m.connectors.demo.config = { count: "lots" } as never;
    const dir = project(m, { "connectors/demo/index.ts": DEMO_CONNECTOR });
    const errors = await checkConnectors(dir, await readManifest(dir));
    expect(errors.some((e) => e.field?.startsWith("config."))).toBe(true);
  });

  it("rejects a mapped output the connector does not declare", async () => {
    const m = demoManifest();
    m.connectors.demo.datasets = { logs: "logs", ghost: "snapshot" };
    const dir = project(m, { "connectors/demo/index.ts": DEMO_CONNECTOR });
    const errors = await checkConnectors(dir, await readManifest(dir));
    expect(errors.some((e) => /not declared/.test(e.message))).toBe(true);
  });

  it("rejects an invalid schedule", async () => {
    const m = demoManifest({ schedule: "soon" });
    const dir = project(m, { "connectors/demo/index.ts": DEMO_CONNECTOR });
    const errors = await checkConnectors(dir, await readManifest(dir));
    expect(errors.some((e) => e.field === "schedule")).toBe(true);
  });

  it("accepts a valid connector", async () => {
    const dir = project(demoManifest(), { "connectors/demo/index.ts": DEMO_CONNECTOR });
    const errors = await checkConnectors(dir, await readManifest(dir));
    expect(errors, JSON.stringify(errors)).toEqual([]);
  });
});

describe("sync writes + cursor state", () => {
  it("inserts and replaces, creating missing files, and advances the cursor", async () => {
    process.env.DEMO_TOKEN = "t";
    const dir = project(demoManifest(), { "connectors/demo/index.ts": DEMO_CONNECTOR });

    const first = await runConnectorSync(dir, "demo");
    expect(first.datasets.logs!.mode).toBe("insert");
    expect(first.datasets.logs!.rows).toBe(2);
    expect(first.datasets.snapshot!.mode).toBe("replace");
    expect(first.datasets.snapshot!.rows).toBe(1);

    const logs = await query(dir, "logs");
    expect(logs.rows.length).toBe(2);
    const snap = await query(dir, "snapshot");
    expect(snap.rows[0]!.total).toBe(2);

    const second = await runConnectorSync(dir, "demo");
    expect(second.datasets.logs!.rows).toBe(2);
    const logs2 = await query(dir, "logs");
    expect(logs2.rows.length).toBe(4);
    expect(logs2.rows.map((r) => r.id)).toEqual([0, 1, 2, 3]);
    const snap2 = await query(dir, "snapshot");
    expect(snap2.rows.length).toBe(1);
    expect(snap2.rows[0]!.total).toBe(4);
  });

  it("persists state and lastSync, and the insert snapshot supports rollback", async () => {
    process.env.DEMO_TOKEN = "t";
    const dir = project(demoManifest(), { "connectors/demo/index.ts": DEMO_CONNECTOR });
    await runConnectorSync(dir, "demo");
    await runConnectorSync(dir, "demo");

    const statePath = join(dir, ".openislands", "connectors", "demo.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.state.seen).toBe(4);
    expect(typeof state.lastSync).toBe("string");
    expect(state.lastError).toBeUndefined();

    const statuses = await listConnectorStatuses(dir);
    const demo = statuses.find((s) => s.name === "demo")!;
    expect(demo.connected).toBe(true);
    expect(demo.schedule).toBe("6h");
    expect(demo.lastSync).toBe(state.lastSync);

    const historyDir = join(dir, ".openislands", "history");
    const snapshots = existsSync(historyDir) ? readFileSync : null;
    expect(snapshots).not.toBeNull();
  });

  it("records lastError and rethrows when sync throws", async () => {
    process.env.DEMO_TOKEN = "t";
    const broken = `
      import { defineConnector } from "@openislands/connector-kit";
      export default defineConnector({
        outputs: { logs: {} },
        async sync() { throw new Error("provider exploded"); },
      });
    `;
    const m = demoManifest();
    m.connectors.demo.datasets = { logs: "logs" };
    const dir = project(m, { "connectors/demo/index.ts": broken });
    await expect(runConnectorSync(dir, "demo")).rejects.toThrow("provider exploded");
    const state = JSON.parse(readFileSync(join(dir, ".openislands", "connectors", "demo.json"), "utf8"));
    expect(state.lastError).toBe("provider exploded");
  });
});

describe("status without secrets", () => {
  it("reports a keyless connector as not connected when its secret is missing", async () => {
    const dir = project(demoManifest(), { "connectors/demo/index.ts": DEMO_CONNECTOR });
    const statuses = await listConnectorStatuses(dir);
    const demo = statuses.find((s) => s.name === "demo")!;
    expect(demo.auth).toBe("none");
    expect(demo.connected).toBe(false);
    expect(demo.missingSecrets).toContain("DEMO_TOKEN");
  });
});

describe("sync-directly affordance", () => {
  it("marks a keyless connector as directly syncable with a no-authorization note", async () => {
    const dir = project(demoManifest(), { "connectors/demo/index.ts": DEMO_CONNECTOR });
    const demo = (await listConnectorStatuses(dir)).find((s) => s.name === "demo")!;
    expect(demo.auth).toBe("none");
    expect(demo.canSyncDirectly).toBe(true);
    expect(demo.note).toMatch(/sync directly|no authorization/i);
  });

  it("marks a bearer connector as needing a human connect first", async () => {
    const m = demoManifest();
    m.connectors.demo.datasets = { logs: "logs" };
    delete (m.datasets as Record<string, unknown>).snapshot;
    const dir = project(m, { "connectors/demo/index.ts": BEARER_CONNECTOR });
    const demo = (await listConnectorStatuses(dir)).find((s) => s.name === "demo")!;
    expect(demo.auth).toBe("bearer");
    expect(demo.canSyncDirectly).toBe(false);
    expect(demo.note).toMatch(/human must connect/i);
  });
});

// --- Bearer auth ----------------------------------------------------------------
// A static long-lived token from .env, delivered to sync as ctx.tokens.accessToken
// exactly like an OAuth access token — no interactive Connect, connected = env set.

describe("bearer auth", () => {
  function bearerProject(): string {
    const m = demoManifest();
    m.connectors.demo.datasets = { logs: "logs" };
    delete (m.datasets as Record<string, unknown>).snapshot;
    return project(m, { "connectors/demo/index.ts": BEARER_CONNECTOR });
  }

  it("reports auth bearer, not connected, and the token env as missing when unset", async () => {
    const dir = bearerProject();
    const demo = (await listConnectorStatuses(dir)).find((s) => s.name === "demo")!;
    expect(demo.auth).toBe("bearer");
    expect(demo.connected).toBe(false);
    expect(demo.missingSecrets).toContain("DEMO_BEARER");
  });

  it("reports connected and hands the env token to sync once the token is set", async () => {
    process.env.DEMO_BEARER = "jwt-123";
    const dir = bearerProject();

    const demo = (await listConnectorStatuses(dir)).find((s) => s.name === "demo")!;
    expect(demo.connected).toBe(true);
    expect(demo.missingSecrets).toEqual([]);

    await runConnectorSync(dir, "demo");
    const logs = await query(dir, "logs");
    expect(logs.rows[0]!.token).toBe("jwt-123");
  });

  it("throws naming the token env when syncing while the token is unset", async () => {
    const dir = bearerProject();
    await expect(runConnectorSync(dir, "demo")).rejects.toThrow(/DEMO_BEARER|not connected/);
  });
});

// --- OAuth2 against a local server ----------------------------------------------

interface OAuthServer {
  server: Server;
  origin: string;
  exchanged: Record<string, unknown> | null;
  refreshed: Record<string, unknown> | null;
}

function startOAuthServer(): Promise<OAuthServer> {
  const state: OAuthServer = { server: undefined as never, origin: "", exchanged: null, refreshed: null };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const params = Object.fromEntries(new URLSearchParams(body));
      if (params.grant_type === "authorization_code") {
        state.exchanged = params;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }));
        return;
      }
      if (params.grant_type === "refresh_token") {
        state.refreshed = params;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }));
        return;
      }
      res.writeHead(400);
      res.end("bad grant");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      state.server = server;
      state.origin = `http://127.0.0.1:${port}`;
      resolve(state);
    });
  });
}

describe("oauth2 flow", () => {
  it("rejects a state mismatch on callback", async () => {
    const oauth = await startOAuthServer();
    try {
      const m = demoManifest();
      m.connectors.demo.datasets = { logs: "logs" };
      delete (m.datasets as Record<string, unknown>).snapshot;
      const dir = project(m, {
        "connectors/demo/index.ts": OAUTH_CONNECTOR(`${oauth.origin}/auth`, `${oauth.origin}/token`),
      });
      process.env.DEMO_CLIENT_ID = "cid";
      process.env.DEMO_CLIENT_SECRET = "secret";

      await getConnectorAuthorizeUrl(dir, "demo", `${oauth.origin}/cb`);
      await expect(
        completeConnectorOAuth(dir, "demo", { code: "abc", state: "wrong", redirectUri: `${oauth.origin}/cb` }),
      ).rejects.toThrow(/state mismatch/);
    } finally {
      oauth.server.close();
    }
  });

  it("exchanges a code, persists tokens, syncs, and refreshes an expiring token", async () => {
    const oauth = await startOAuthServer();
    try {
      const m = demoManifest();
      m.connectors.demo.datasets = { logs: "logs" };
      delete (m.datasets as Record<string, unknown>).snapshot;
      const dir = project(m, {
        "connectors/demo/index.ts": OAUTH_CONNECTOR(`${oauth.origin}/auth`, `${oauth.origin}/token`),
      });
      process.env.DEMO_CLIENT_ID = "cid";
      process.env.DEMO_CLIENT_SECRET = "secret";

      const url = await getConnectorAuthorizeUrl(dir, "demo", `${oauth.origin}/cb`);
      const parsed = new URL(url);
      expect(parsed.searchParams.get("client_id")).toBe("cid");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      const oauthState = parsed.searchParams.get("state")!;
      expect(parsed.searchParams.get("scope")).toBe("read:all");

      await completeConnectorOAuth(dir, "demo", { code: "the-code", state: oauthState, redirectUri: `${oauth.origin}/cb` });
      expect(oauth.exchanged!.code).toBe("the-code");

      const statePath = join(dir, ".openislands", "connectors", "demo.json");
      let saved = JSON.parse(readFileSync(statePath, "utf8"));
      expect(saved.tokens.accessToken).toBe("access-1");
      expect(saved.pendingOAuth).toBeUndefined();

      const statuses = await listConnectorStatuses(dir);
      expect(statuses.find((s) => s.name === "demo")!.connected).toBe(true);

      await runConnectorSync(dir, "demo");
      const logs = await query(dir, "logs");
      expect(logs.rows[0]!.token).toBe("access-1");

      // Force the token to look expiring, then sync again to trigger a refresh.
      saved = JSON.parse(readFileSync(statePath, "utf8"));
      saved.tokens.expiresAt = new Date(Date.now() + 10_000).toISOString();
      writeFileSync(statePath, JSON.stringify(saved));
      resetConnectorCache();

      await runConnectorSync(dir, "demo");
      expect(oauth.refreshed!.refresh_token).toBe("refresh-1");
      const after = JSON.parse(readFileSync(statePath, "utf8"));
      expect(after.tokens.accessToken).toBe("access-2");
      const logs2 = await query(dir, "logs");
      expect(logs2.rows.some((r) => r.token === "access-2")).toBe(true);

      await disconnectConnector(dir, "demo");
      const disconnected = JSON.parse(readFileSync(statePath, "utf8"));
      expect(disconnected.tokens).toBeUndefined();
    } finally {
      oauth.server.close();
    }
  });
});

// --- SQLite-backed connector outputs --------------------------------------------
// Connector writes reuse the same storage-agnostic path as actions, so an output
// mapped to a `{ source: "*.sqlite", table }` dataset works identically: ctx.insert
// adds rows to the table, ctx.replace overwrites every row in it.

function sqliteConnectorManifest() {
  return {
    version: 1,
    title: "Demo",
    datasets: {
      logs: { source: "data/logs.sqlite", table: "logs" },
      snapshot: { source: "data/snapshot.sqlite", table: "snap" },
    },
    pages: [{ id: "p", islands: [{ type: "note.card", markdown: "x" }] }],
    connectors: {
      demo: { module: "connectors/demo", datasets: { logs: "logs", snapshot: "snapshot" }, config: { count: 2 } },
    },
  };
}

describe("sync writes into sqlite-backed outputs", () => {
  it("inserts into one sqlite table and replaces another, then queries them back", async () => {
    process.env.DEMO_TOKEN = "t";
    const dir = project(sqliteConnectorManifest(), { "connectors/demo/index.ts": DEMO_CONNECTOR });
    for (const [file, table] of [["logs.sqlite", "logs"], ["snapshot.sqlite", "snap"]] as const) {
      const db = new DatabaseSync(join(dir, "data", file));
      if (table === "logs") db.exec("CREATE TABLE logs (id INTEGER, label TEXT)");
      else db.exec("CREATE TABLE snap (total INTEGER)");
      db.close();
    }

    const first = await runConnectorSync(dir, "demo");
    expect(first.datasets.logs!.mode).toBe("insert");
    expect(first.datasets.snapshot!.mode).toBe("replace");

    expect((await query(dir, "logs")).rows.map((r) => r.id)).toEqual([0, 1]);
    expect((await query(dir, "snapshot")).rows).toEqual([{ total: 2 }]);

    await runConnectorSync(dir, "demo");
    // insert appends to the table: four rows after two syncs of two events each.
    expect((await query(dir, "logs")).rows.map((r) => r.id)).toEqual([0, 1, 2, 3]);
    // replace overwrites the whole table: still one row, with the new total.
    expect((await query(dir, "snapshot")).rows).toEqual([{ total: 4 }]);
  });
});
