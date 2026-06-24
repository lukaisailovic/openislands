#!/usr/bin/env node
/**
 * openislands — the CLI. Humans and agents share this surface.
 *
 *   openislands init [dir] --template finance|health|operations
 *   openislands validate [dir]
 *   openislands serve [dir]    # the long-running local runtime (live)
 *   openislands add <island-type> [dir]
 *   openislands infer <file> [dir]      # infer a data file's schema → dataset contract (--bind to write)
 *   openislands sync [dir] [connector]  # one-shot connector pull (cron-able)
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync, mkdirSync, cpSync, readdirSync, renameSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { compile, discoverApps, inferFile, isSafeAppId, listConnectorStatuses, runConnectorSync } from "@openislands/compiler";
import type { ConnectorStatus, SourceSchema, SyncResult } from "@openislands/compiler";
import { BUILTIN_ISLAND_TYPES, flattenPageIslands, validateManifest } from "@openislands/schema";
import { allowedHostsFromEnv, apiRequestForbiddenReason, assertMcpHostSafe, clientIpAllowed, envFlag, handleServeRequest, newMcpHandlerHolder, parseAllowedIps, warnRuntimeHostExposed, type McpConfig, type McpHandlerHolder } from "./serve.js";
import { datasetNameFromFile, islandSkeleton, suggestIslands } from "./scaffold.js";

interface FetchServer {
  fetch: (request: Request) => Response | Promise<Response>;
}

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

function templatesDir(): string {
  // dev: repo templates next to packages/. published: bundled alongside the CLI.
  for (const rel of ["../../../templates", "../templates", "./templates"]) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return p;
  }
  return fileURLToPath(new URL("../../../templates", import.meta.url));
}

/** Read from package.json so `openislands --version` tracks the published release (the release
 * workflow bumps package.json; this follows automatically). Resolves to the package root from
 * both the bundled dist/ and the tsx-run src/. */
const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const program = new Command();
program
  .name("openislands")
  .description("Agent-built dashboards over data you own, that don't rot.")
  .version(VERSION);

program
  .command("init [project]")
  .description("scaffold a new dashboard project from a template (blank by default)")
  .option("-t, --template <name>", "empty | finance | health | operations", "empty")
  .option("--app <id>", "name the app folder under apps/ (defaults to the template's own id)")
  .action((project: string | undefined, opts: { template: string; app?: string }) => {
    const dir = project ?? "openislands";
    const target = resolve(dir);
    const src = join(templatesDir(), opts.template);
    if (!existsSync(src)) {
      console.error(
        c.red(`Unknown template '${opts.template}'. Available: ${readdirSync(templatesDir()).join(", ")}`),
      );
      process.exit(1);
    }
    if (opts.app !== undefined && !isSafeAppId(opts.app)) {
      console.error(c.red(`invalid app id '${opts.app}' — use letters, digits, '.', '_' or '-'.`));
      process.exit(1);
    }
    mkdirSync(target, { recursive: true });
    cpSync(src, target, { recursive: true });
    if (opts.app !== undefined) renameScaffoldedApp(target, opts.app);
    console.log(`${c.green("✓")} created ${c.bold(opts.template)} dashboard in ${target}`);
    console.log(c.dim(`  next: cd ${dir} && openislands serve`));
  });

/** The single app id under a freshly-copied template's `apps/` (a template ships exactly one app). */
function templateDefaultAppId(projectDir: string): string {
  const appsDir = join(projectDir, "apps");
  const ids = readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  if (ids.length !== 1) {
    console.error(c.red(`expected exactly one app under ${appsDir}, found ${ids.length}: ${ids.join(", ") || "(none)"}`));
    process.exit(1);
  }
  return ids[0]!;
}

/** Override the scaffolded app folder name when `--app` differs from the template's default. */
function renameScaffoldedApp(projectDir: string, appId: string): void {
  const defaultId = templateDefaultAppId(projectDir);
  if (defaultId === appId) return;
  const from = join(projectDir, "apps", defaultId);
  const to = join(projectDir, "apps", appId);
  if (existsSync(to)) {
    console.error(c.red(`apps/${appId} already exists in the template — choose a different --app id.`));
    process.exit(1);
  }
  renameSync(from, to);
}

program
  .command("validate [project]")
  .description("validate every app's manifest + check every island against its data")
  .option("--app <id>", "validate only this app")
  .action(async (project: string | undefined, opts: { app?: string }) => {
    const root = resolve(project ?? ".");
    const apps = resolveApps(root, opts.app);
    if (apps.length === 0) exitNoApps(root);
    let failed = false;
    for (const app of apps) {
      console.log(c.bold(`\n${app}`));
      if ((await runValidate(join(root, "apps", app))) !== 0) failed = true;
    }
    process.exit(failed ? 1 : 0);
  });

program
  .command("serve [project]")
  .description(
    "run your dashboard as a long-running local app (the live TanStack Start SSR runtime)",
  )
  .option("-p, --port <port>", "port", "4321")
  .option("--host <host>", "bind address (loopback by default — this is your data)", "127.0.0.1")
  .option("--mcp", "also mount the MCP server over Streamable HTTP on the same port")
  .option("--mcp-token <token>", "bearer token required on MCP requests (also $OPENISLANDS_MCP_TOKEN)")
  .action(async (project: string | undefined, opts: { port: string; host: string; mcp?: boolean; mcpToken?: string }) => {
    const root = resolve(project ?? ".");
    const port = Number(process.env.OPENISLANDS_PORT ?? opts.port);
    const host = process.env.OPENISLANDS_HOST ?? opts.host;
    const mcpEnabled = opts.mcp || envFlag(process.env.OPENISLANDS_MCP);
    const mcpToken = opts.mcpToken ?? process.env.OPENISLANDS_MCP_TOKEN ?? null;
    assertMcpHostSafe(host, mcpEnabled, mcpToken);
    warnRuntimeHostExposed(host, parseAllowedIps(process.env.OPENISLANDS_ALLOWED_IPS));

    const apps = findWorkspaceApps(root);
    if (apps.length === 0) exitNoApps(root);

    let failed = false;
    for (const app of apps) {
      const report = await compile(join(root, "apps", app));
      if (report.ok) console.log(`${c.green("✓")} ${c.bold(report.manifest!.title)} ${c.dim(`(${app})`)}`);
      else {
        console.log(`${c.red("✗")} ${c.bold(app)} ${c.dim(`(${report.errors.length} error(s))`)}`);
        printErrors(report.errors);
        failed = true;
      }
    }
    if (failed) {
      console.log(c.red("\n✗ refusing to serve a workspace with apps that can't render — fix the above first."));
      process.exit(1);
    }

    writeDefaultWorkspaceConfig(root, apps);
    const mcp: McpConfig | undefined = mcpEnabled ? { token: mcpToken, projectRoot: root } : undefined;
    await bootRuntime({ OPENISLANDS_PROJECT_DIR: root }, host, port, mcp);
  });

program
  .command("add <island> [project]")
  .description(`add an island instance (${BUILTIN_ISLAND_TYPES.join(", ")})`)
  .option("--app <id>", "the app to add to (defaults to the sole app)")
  .action((island: string, project: string | undefined, opts: { app?: string }) => {
    const root = resolve(project ?? ".");
    const app = resolveSingleApp(root, opts.app);
    const manifestPath = join(root, "apps", app, "manifest.json");
    if (!existsSync(manifestPath)) {
      console.error(c.red(`no manifest at ${manifestPath}`));
      process.exit(1);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const skeleton = islandSkeleton(island);
    const firstPage = manifest.pages[0];
    const target = Array.isArray(firstPage.islands) ? firstPage.islands : firstPage.groups?.[0]?.islands;
    if (!target) {
      console.error(c.red(`page '${firstPage.id}' has no islands or groups to add to`));
      process.exit(1);
    }
    target.push(skeleton);
    const v = validateManifest(manifest);
    if (!v.ok) {
      console.error(c.red("the new island wouldn't validate — not written:"));
      printErrors(v.errors.map((e) => `[${e.page}#${e.index} ${e.type}] ${e.message}`));
      process.exit(1);
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(
      `${c.green("✓")} added ${c.bold(island)} to page '${manifest.pages[0].id}' ${c.dim("(fill in its dataset + fields, then build)")}`,
    );
  });

program
  .command("infer <file> [project]")
  .description("infer a data file's schema, propose a dataset contract + islands; --bind adds it to the manifest")
  .option("--app <id>", "the app to bind to (defaults to the sole app)")
  .option("--bind", "add the inferred dataset to the app's manifest")
  .action(async (file: string, project: string | undefined, opts: { app?: string; bind?: boolean }) => {
    const root = resolve(project ?? ".");
    const app = resolveSingleApp(root, opts.app);
    process.exit(await runInfer(file, join(root, "apps", app), opts.bind ?? false));
  });

program
  .command("sync [project] [connector]")
  .description(
    "pull configured connectors once and write their datasets across every app (cron this for headless refresh)",
  )
  .option("--app <id>", "sync only this app")
  .action(async (project: string | undefined, connector: string | undefined, opts: { app?: string }) => {
    const root = resolve(project ?? ".");
    const apps = resolveApps(root, opts.app);
    if (apps.length === 0) exitNoApps(root);
    let failed = false;
    for (const app of apps) {
      console.log(c.bold(`\n${app}`));
      if ((await runSync(join(root, "apps", app), connector)) !== 0) failed = true;
    }
    process.exit(failed ? 1 : 0);
  });

program
  .command("add-app <id> [project]")
  .description("scaffold one more app into an existing project from a template")
  .option("-t, --template <name>", "empty | finance | health | operations", "empty")
  .action((id: string, project: string | undefined, opts: { template: string }) => {
    const root = resolve(project ?? ".");
    if (!isSafeAppId(id)) {
      console.error(c.red(`invalid app id '${id}' — use letters, digits, '.', '_' or '-'.`));
      process.exit(1);
    }
    const appsDir = join(root, "apps");
    if (!existsSync(appsDir)) {
      console.error(c.red(`${root} is not an OpenIslands project (no apps/ directory) — run \`openislands init\` first.`));
      process.exit(1);
    }
    const dest = join(appsDir, id);
    if (existsSync(dest)) {
      console.error(c.red(`apps/${id} already exists — choose a different id.`));
      process.exit(1);
    }
    const templateRoot = join(templatesDir(), opts.template);
    if (!existsSync(templateRoot)) {
      console.error(c.red(`Unknown template '${opts.template}'. Available: ${readdirSync(templatesDir()).join(", ")}`));
      process.exit(1);
    }
    const src = join(templateRoot, "apps", templateDefaultAppId(templateRoot));
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    console.log(`${c.green("✓")} added app ${c.bold(id)} from ${c.bold(opts.template)} → ${dest}`);
    console.log(c.dim(`  next: openislands serve`));
  });

/** The file path a dataset should reference: project-relative POSIX if inside the project, else absolute. */
function datasetSourcePath(absFile: string, projectDir: string): string {
  const rel = relative(projectDir, absFile);
  if (rel.startsWith("..") || isAbsolute(rel)) return absFile;
  return rel.split(sep).join("/");
}

async function runInfer(file: string, projectDir: string, bind: boolean): Promise<number> {
  const absFile = resolve(file);
  if (!existsSync(absFile)) {
    console.error(c.red(`no file at ${absFile}`));
    return 1;
  }

  let schema: SourceSchema;
  try {
    schema = await inferFile(absFile);
  } catch (err) {
    console.error(c.red(err instanceof Error ? err.message : String(err)));
    return 1;
  }

  const name = datasetNameFromFile(file);
  const src = datasetSourcePath(absFile, projectDir);

  if (!bind) {
    printInferPreview(name, src, schema);
    return 0;
  }

  return bindInferredDataset(absFile, projectDir, name, src);
}

function printInferPreview(name: string, src: string, schema: SourceSchema): void {
  const width = Math.max(...schema.columns.map((col) => col.name.length));
  console.log(c.bold(`\nInferred ${schema.columns.length} column(s):`));
  for (const col of schema.columns) {
    console.log(`  ${col.name.padEnd(width)}  ${c.dim(col.type)}`);
  }

  console.log(c.bold("\nProposed dataset:"));
  console.log(JSON.stringify({ [name]: { source: src } }, null, 2));

  console.log(c.bold("\nSuggested islands:"));
  console.log(JSON.stringify(suggestIslands(name, schema.columns), null, 2));

  console.log(c.dim(`\nhint: re-run with --bind to add '${name}' to the manifest.`));
}

function bindInferredDataset(absFile: string, projectDir: string, name: string, src: string): number {
  const manifestPath = join(projectDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(c.red(`no manifest at ${manifestPath}`));
    return 1;
  }
  if (isAbsolute(src)) {
    console.error(c.red(`${absFile} is outside the project — move it under ${join(projectDir, "data")}/ first, then re-run --bind`));
    return 1;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.datasets ??= {};
  if (manifest.datasets[name]) {
    console.error(c.red(`dataset name '${name}' is taken — rename the file or edit the manifest`));
    return 1;
  }
  manifest.datasets[name] = { source: src };

  const v = validateManifest(manifest);
  if (!v.ok) {
    console.error(c.red("adding the dataset wouldn't validate — not written:"));
    printErrors(v.errors.map((e) => `[${e.page}#${e.index} ${e.type}] ${e.message}`));
    return 1;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${c.green("✓")} added dataset ${c.bold(name)} → ${src}`);
  console.log(c.dim(`  next: openislands add <island-type> (then bind it to '${name}'), or openislands serve`));
  return 0;
}

async function runSync(root: string, connector: string | undefined): Promise<number> {
  const statuses = await listConnectorStatuses(root);
  if (statuses.length === 0) {
    console.log(c.dim("no connectors configured in the manifest — nothing to sync."));
    return 0;
  }

  if (connector !== undefined && !statuses.some((s) => s.name === connector)) {
    console.error(
      c.red(
        `unknown connector '${connector}'. Configured: ${statuses.map((s) => s.name).join(", ")}`,
      ),
    );
    return 1;
  }

  const targets = connector === undefined ? statuses : statuses.filter((s) => s.name === connector);
  let failed = false;
  for (const status of targets) {
    if (!(await syncOne(root, status))) failed = true;
  }
  return failed ? 1 : 0;
}

async function syncOne(root: string, status: ConnectorStatus): Promise<boolean> {
  if (status.loadError) {
    console.error(`${c.red("✗")} ${c.bold(status.name)} — failed to load: ${status.loadError}`);
    return false;
  }
  if (!status.connected) {
    console.error(`${c.red("✗")} ${c.bold(status.name)} — not connected.`);
    if (status.missingSecrets.length > 0) {
      console.error(c.dim(`  missing env: ${status.missingSecrets.join(", ")}`));
    }
    if (status.auth === "oauth2") {
      console.error(c.dim("  open the dashboard (openislands serve) and click Connect to authorize."));
    }
    return false;
  }

  try {
    const result = await runConnectorSync(root, status.name);
    printSyncResult(result);
    return true;
  } catch (err) {
    console.error(
      `${c.red("✗")} ${c.bold(status.name)} — sync failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

function printSyncResult(result: SyncResult): void {
  console.log(`${c.green("✓")} ${c.bold(result.connector)} ${c.dim(`(${result.durationMs}ms)`)}`);
  const datasets = Object.entries(result.datasets);
  if (datasets.length === 0) {
    console.log(c.dim("  no datasets written"));
    return;
  }
  for (const [dataset, { mode, rows }] of datasets) {
    console.log(`  ${c.green("→")} ${dataset}: ${rows} row(s) ${c.dim(mode)}`);
  }
}

async function runValidate(root: string): Promise<number> {
  const report = await compile(root);
  if (!report.ok) {
    printErrors(report.errors);
    console.log(
      c.red(
        `\n✗ ${report.errors.length} problem(s). The dashboard would not render — fix these and it will.`,
      ),
    );
    return 1;
  }
  const islands = report.islandChecks.length;
  const datasets = Object.keys(report.snapshots).length;
  console.log(`${c.green("✓")} ${c.bold(report.manifest!.title)} is valid`);
  console.log(
    c.dim(
      `  ${datasets} dataset(s) materialized · ${islands} island(s) checked, all bound correctly`,
    ),
  );
  if (report.manifest) {
    const customCount = report.manifest.pages
      .flatMap((p) => flattenPageIslands(p))
      .filter(({ island }) => !BUILTIN_ISLAND_TYPES.includes((island as { type: string }).type as never)).length;
    if (customCount > 0)
      console.log(
        c.dim(`  ${customCount} custom island(s) — register a renderer in components/custom/`),
      );
  }
  printWarnings(report.warnings);
  return 0;
}

/**
 * The client-facing origin of a request, rebuilt from the `Host` header (and `x-forwarded-proto`
 * behind a TLS-terminating proxy) — not the bind address. TanStack Start's default CSRF middleware
 * compares this against the request's Origin/Referer, so a `0.0.0.0` bind reached over a LAN IP must
 * reflect that IP here or every `/_serverFn/*` call 403s. Falls back to the bind origin when no Host.
 */
function requestOrigin(req: IncomingMessage, fallback: string): string {
  const host = req.headers.host;
  if (!host) return fallback;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}

async function toWebRequest(req: IncomingMessage, fallbackOrigin: string): Promise<Request> {
  const url = `${requestOrigin(req, fallbackOrigin)}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    // @ts-expect-error duplex is required by Node when streaming a request body
    duplex: hasBody ? "half" : undefined,
  });
}

async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  await new Promise<void>((done, fail) => {
    const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    stream.on("error", fail);
    res.on("close", () => stream.destroy());
    stream.pipe(res).on("finish", () => done());
  });
}

/**
 * Boots the built TanStack Start server from @openislands/runtime as a real
 * Node http server, bound to the loopback host. OPENISLANDS_PROJECT_DIR (the
 * project/workspace root, scanned for apps/*) must be set before the bundle is
 * imported — the runtime reads it to find the user's files, and each app's file
 * watcher (live updates) starts on its first SSE client.
 */
const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * The Start fetch handler only does SSR + API routes — the hashed client bundle
 * (hydration JS, CSS, lazy chart/table chunks) is plain files in the runtime's
 * dist/client, served here.
 */
function serveClientAsset(clientDir: string, req: IncomingMessage, res: ServerResponse): boolean {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;
  const pathname = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  if (pathname.includes("\0") || pathname.includes("..")) return false;
  const ext = Object.keys(ASSET_TYPES).find((e) => pathname.endsWith(e));
  if (!ext) return false;
  const file = join(clientDir, pathname);
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.statusCode = 200;
  res.setHeader("content-type", ASSET_TYPES[ext]!);
  if (pathname.startsWith("/assets/")) res.setHeader("cache-control", "public, max-age=31536000, immutable");
  if (method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}

/** App ids under `<root>/apps` that hold a manifest, sorted. Empty when `<root>/apps` is absent. */
export function findWorkspaceApps(root: string): string[] {
  return discoverApps(root).map((app) => app.id);
}

function exitNoApps(root: string): never {
  console.error(c.red(`no apps under ${join(root, "apps")} — run \`openislands init\` or \`openislands add-app\` first.`));
  process.exit(1);
}

function assertKnownApp(apps: string[], appId: string): void {
  if (apps.includes(appId)) return;
  console.error(c.red(`unknown app '${appId}'. Available: ${apps.length ? apps.join(", ") : "(none)"}`));
  process.exit(1);
}

/** The app ids `validate`/`sync` operate on: a named app (validated) or every app. */
function resolveApps(root: string, appOpt: string | undefined): string[] {
  const apps = findWorkspaceApps(root);
  if (appOpt === undefined) return apps;
  assertKnownApp(apps, appOpt);
  return [appOpt];
}

/** The single app `add`/`infer` operate on: the named one, or the sole app, else a loud error. */
function resolveSingleApp(root: string, appOpt: string | undefined): string {
  const apps = findWorkspaceApps(root);
  if (appOpt !== undefined) {
    assertKnownApp(apps, appOpt);
    return appOpt;
  }
  if (apps.length === 1) return apps[0]!;
  if (apps.length === 0) exitNoApps(root);
  console.error(c.red(`multiple apps — pass --app <id> (one of: ${apps.join(", ")})`));
  process.exit(1);
}

function writeDefaultWorkspaceConfig(root: string, apps: string[]): void {
  const path = join(root, "openislands.json");
  if (existsSync(path)) return;
  writeFileSync(path, JSON.stringify({ order: apps }, null, 2) + "\n");
}

async function bootRuntime(
  env: { OPENISLANDS_PROJECT_DIR: string },
  host: string,
  port: number,
  mcp?: McpConfig,
): Promise<void> {
  Object.assign(process.env, env);
  const mod = (await import("@openislands/runtime/server")) as { default: FetchServer };
  const handler = mod.default;
  const serverEntry = fileURLToPath(import.meta.resolve("@openislands/runtime/server"));
  const clientDir = join(dirname(serverEntry), "..", "client");
  const origin = `http://${host}:${port}`;
  const allowedHosts = allowedHostsFromEnv(process.env.OPENISLANDS_ALLOWED_HOSTS);
  const allowedIps = parseAllowedIps(process.env.OPENISLANDS_ALLOWED_IPS);
  const mcpHandler = newMcpHandlerHolder();

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (!clientIpAllowed(req.socket.remoteAddress, allowedIps)) {
          res.statusCode = 403;
          res.setHeader("content-type", "text/plain");
          res.end(`client IP '${req.socket.remoteAddress ?? "unknown"}' is not allowed — add it to OPENISLANDS_ALLOWED_IPS`);
          return;
        }
        if (handleServeRequest(mcp, mcpHandler, req, res)) return;
        if (serveClientAsset(clientDir, req, res)) return;
        if ((req.url ?? "/").split("?")[0]!.startsWith("/api/")) {
          const forbidden = apiRequestForbiddenReason(req, host, allowedHosts);
          if (forbidden) {
            res.statusCode = 403;
            res.setHeader("content-type", "text/plain");
            res.end(forbidden);
            return;
          }
        }
        const response = await handler.fetch(await toWebRequest(req, origin));
        await writeWebResponse(response, res);
      } catch (err) {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : String(err));
      }
    })();
  });

  await new Promise<void>((listening, failed) => {
    server.once("error", failed);
    server.listen(port, host, () => {
      server.removeListener("error", failed);
      listening();
    });
  });
  server.on("error", (err) => console.error(c.red(`runtime server error: ${friendlyMessage(err)}`)));
  installGracefulShutdown(server, mcpHandler);

  console.log(
    `${c.green("●")} OpenIslands runtime → ${c.bold(origin)}  ${c.dim("live SSR · Ctrl-C to stop")}`,
  );
  if (mcp) {
    const auth = mcp.token ? "token-protected" : "loopback (no token)";
    console.log(`${c.green("●")} MCP over HTTP → ${c.bold("/mcp")}  ${c.dim(`${auth} · Ctrl-C to stop`)}`);
  }
}

/** On Ctrl-C / SIGTERM, stop accepting connections and exit cleanly instead of being killed mid-request. */
function installGracefulShutdown(server: Server, mcpHandler: McpHandlerHolder): void {
  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    console.log(c.dim(`\n${signal} — shutting down.`));
    void mcpHandler.handler?.close().catch(() => {});
    server.close(() => process.exit(0));
    // Long-lived SSE streams keep close() from ever completing — don't hang on them.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

/** A one-line human message for an error — names the cause for known Node listen failures. */
function friendlyMessage(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as NodeJS.ErrnoException & { address?: string; port?: number };
    if (e.code === "EADDRINUSE")
      return `port ${e.port} is already in use — stop whatever is using it, or serve with a different --port.`;
    if (e.code === "EACCES")
      return `not allowed to bind ${e.address ?? "the host"}:${e.port ?? ""} — ports below 1024 need elevated privileges; pick a higher --port.`;
    if (e.code === "EADDRNOTAVAIL")
      return `can't bind to host '${e.address ?? ""}' — it isn't an address on this machine; check --host.`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Last resort for any unhandled failure: print a clean message and exit non-zero — never dump a raw stack. */
function die(err: unknown): never {
  console.error(`\n${c.red("✗")} ${friendlyMessage(err)}`);
  process.exit(1);
}

function printErrors(errors: string[]): void {
  console.error(c.red(c.bold("\nThis dashboard can't render:")));
  for (const e of errors) console.error(`  ${c.red("✗")} ${e}`);
}
function printWarnings(warnings: string[]): void {
  if (warnings.length === 0) return;
  console.log(c.yellow(`\n${warnings.length} layout suggestion(s) — advisory, the dashboard still renders:`));
  for (const w of warnings) console.log(`  ${c.yellow("!")} ${c.dim(w)}`);
}

process.on("uncaughtException", die);
process.on("unhandledRejection", die);
program.parseAsync().catch(die);
