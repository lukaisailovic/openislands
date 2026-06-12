#!/usr/bin/env node
/**
 * openislands — the CLI. Humans and agents share this surface.
 *
 *   openislands init [dir] --template finance|health|operations
 *   openislands validate [dir]
 *   openislands serve [dir]    # the long-running local runtime (live)
 *   openislands add <island-type> [dir]
 *   openislands sync [dir] [connector]  # one-shot connector pull (cron-able)
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { compile, listConnectorStatuses, runConnectorSync } from "@openislands/compiler";
import type { ConnectorStatus, SyncResult } from "@openislands/compiler";
import { BUILTIN_ISLAND_TYPES, flattenPageIslands, validateManifest } from "@openislands/schema";

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

const program = new Command();
program
  .name("openislands")
  .description("Agent-built dashboards over data you own, that don't rot.")
  .version("0.1.0");

program
  .command("init [dir]")
  .description("scaffold a new dashboard project from a template")
  .option("-t, --template <name>", "finance | health | operations", "finance")
  .action((dir: string | undefined, opts: { template: string }) => {
    const target = resolve(dir ?? ".");
    const src = join(templatesDir(), opts.template);
    if (!existsSync(src)) {
      console.error(
        c.red(
          `Unknown template '${opts.template}'. Available: ${readdirSync(templatesDir()).join(", ")}`,
        ),
      );
      process.exit(1);
    }
    mkdirSync(target, { recursive: true });
    cpSync(src, target, { recursive: true });
    console.log(`${c.green("✓")} created ${c.bold(opts.template)} dashboard in ${target}`);
    console.log(c.dim(`  next: cd ${dir ?? "."} && openislands serve`));
  });

program
  .command("validate [dir]")
  .description("validate the manifest + check every island against its data")
  .action(async (dir: string | undefined) => {
    process.exit(await runValidate(resolve(dir ?? ".")));
  });

program
  .command("serve [dir]")
  .description(
    "run your dashboard as a long-running local app (the live TanStack Start SSR runtime)",
  )
  .option("-p, --port <port>", "port", "4321")
  .option("--host <host>", "bind address (loopback by default — this is your data)", "127.0.0.1")
  .action(async (dir: string | undefined, opts: { port: string; host: string }) => {
    const root = resolve(dir ?? ".");

    if (existsSync(join(root, "app", "manifest.json"))) {
      const report = await compile(root);
      if (!report.ok) {
        printErrors(report.errors);
        console.log(c.red("\n✗ refusing to serve a dashboard that can't render — fix the above first."));
        process.exit(1);
      }
      console.log(`${c.green("✓")} ${c.bold(report.manifest!.title)} is valid`);
      await bootRuntime({ OPENISLANDS_PROJECT_DIR: root }, opts.host, Number(opts.port));
      return;
    }

    const apps = findWorkspaceApps(root);
    if (apps.length === 0) {
      console.error(
        c.red(
          `no app here (no app/manifest.json in ${root}) and no app projects in its subdirectories.`,
        ),
      );
      process.exit(1);
    }
    for (const app of apps) {
      const report = await compile(join(root, app));
      if (report.ok) console.log(`${c.green("✓")} ${c.bold(report.manifest!.title)} ${c.dim(`(${app})`)}`);
      else console.log(`${c.red("✗")} ${c.bold(app)} ${c.dim(`(${report.errors.length} error(s) — serving in error state)`)}`);
    }
    writeDefaultWorkspaceConfig(root, apps);
    await bootRuntime({ OPENISLANDS_WORKSPACE_DIR: root }, opts.host, Number(opts.port));
  });

program
  .command("add <island> [dir]")
  .description(`add an island instance (${BUILTIN_ISLAND_TYPES.join(", ")})`)
  .action((island: string, dir: string | undefined) => {
    const root = resolve(dir ?? ".");
    const manifestPath = join(root, "app", "manifest.json");
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
  .command("sync [dir] [connector]")
  .description(
    "pull configured connectors once and write their datasets (cron this for headless refresh)",
  )
  .action(async (dir: string | undefined, connector: string | undefined) => {
    process.exit(await runSync(resolve(dir ?? "."), connector));
  });

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

function islandSkeleton(type: string): Record<string, unknown> {
  const base: Record<string, Record<string, unknown>> = {
    "metric.kpi": { type, title: "New metric", dataset: "TODO", value: "TODO" },
    "timeseries.line": { type, title: "New chart", dataset: "TODO", x: "TODO", y: "TODO" },
    "category.bar": { type, title: "New bars", dataset: "TODO", x: "TODO", y: "TODO" },
    "breakdown.treemap": {
      type,
      title: "New breakdown",
      dataset: "TODO",
      label: "TODO",
      value: "TODO",
    },
    "table.grid": { type, title: "New table", dataset: "TODO" },
    "timeline.feed": {
      type,
      title: "New timeline",
      dataset: "TODO",
      ts: "TODO",
      titleField: "TODO",
    },
    "note.card": { type, title: "Note", markdown: "## Note\n\nWrite something." },
    "source.doc": { type, title: "Source", kind: "link", href: "https://" },
  };
  return base[type] ?? { type, title: "New island" };
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

async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const url = `${origin}${req.url ?? "/"}`;
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
 * Node http server, bound to the loopback host. OPENISLANDS_PROJECT_DIR (single
 * app) or OPENISLANDS_WORKSPACE_DIR (a directory of apps) must be set before
 * the bundle is imported — the runtime reads it to find the user's files, and
 * each app's file watcher (live updates) starts on its first SSE client.
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

/** Immediate subdirectories of a workspace root that hold an app project. */
export function findWorkspaceApps(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "app", "manifest.json")))
    .map((d) => d.name)
    .toSorted();
}

function writeDefaultWorkspaceConfig(root: string, apps: string[]): void {
  const path = join(root, "openislands.json");
  if (existsSync(path)) return;
  writeFileSync(path, JSON.stringify({ order: apps }, null, 2) + "\n");
}

async function bootRuntime(
  env: { OPENISLANDS_PROJECT_DIR: string } | { OPENISLANDS_WORKSPACE_DIR: string },
  host: string,
  port: number,
): Promise<void> {
  Object.assign(process.env, env);
  const mod = (await import("@openislands/runtime/server")) as { default: FetchServer };
  const handler = mod.default;
  const serverEntry = fileURLToPath(import.meta.resolve("@openislands/runtime/server"));
  const clientDir = join(dirname(serverEntry), "..", "client");
  const origin = `http://${host}:${port}`;

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (serveClientAsset(clientDir, req, res)) return;
        const response = await handler.fetch(await toWebRequest(req, origin));
        await writeWebResponse(response, res);
      } catch (err) {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : String(err));
      }
    })();
  });

  server.listen(port, host, () => {
    console.log(
      `${c.green("●")} OpenIslands runtime → ${c.bold(origin)}  ${c.dim("live SSR · Ctrl-C to stop")}`,
    );
  });
}

function printErrors(errors: string[]): void {
  console.error(c.red(c.bold("\nThis dashboard can't render:")));
  for (const e of errors) console.error(`  ${c.red("✗")} ${e}`);
}
function printWarnings(warnings: string[]): void {
  for (const w of warnings) console.log(`  ${c.yellow("!")} ${c.dim(w)}`);
}

program.parseAsync();
