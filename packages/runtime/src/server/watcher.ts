import { join, normalize, relative, sep } from "node:path";
import type { FSWatcher } from "chokidar";
import { compile, resetCustomSchemaCache, resetEngine } from "@openislands/compiler";
import type { Manifest } from "@openislands/schema";
import type { IslandValidationError, RuntimeEvent } from "../types.js";
import { resetCustomBuildCache } from "./custom.js";
import { appDir } from "./workspace.js";

const MANIFEST_REL = join("app", "manifest.json");
const COMPONENTS_DIR = "components";
const WATCH_DIRS = ["data", "models", "app", COMPONENTS_DIR] as const;

function isComponentChange(changedRel: string): boolean {
  return normRel(changedRel).startsWith(`${COMPONENTS_DIR}/`);
}

function specPaths(spec: { source?: string; sql?: string }): string[] {
  const paths: string[] = [];
  if (spec.source) paths.push(spec.source);
  if (spec.sql) paths.push(spec.sql);
  return paths;
}

function normRel(path: string): string {
  return normalize(path).split(sep).join("/");
}

function matchesSpecPath(specPath: string, changedRel: string): boolean {
  const spec = normRel(specPath);
  const changed = normRel(changedRel);
  if (!spec.includes("*")) return spec === changed;
  const dir = spec.slice(0, spec.indexOf("*")).replace(/\/$/, "");
  const ext = spec.slice(spec.lastIndexOf("."));
  return changed.startsWith(dir ? `${dir}/` : "") && changed.endsWith(ext);
}

/**
 * Which datasets a changed project-relative file invalidates. A manifest change
 * touches everything (bindings or sources may have moved); a data/model file
 * touches only the datasets whose source or sql transform resolves to it.
 */
export function affectedDatasets(manifest: Manifest, changedRel: string): string[] {
  const changed = normRel(changedRel);
  if (changed === normRel(MANIFEST_REL)) return Object.keys(manifest.datasets);
  const hit = new Set<string>();
  for (const [name, spec] of Object.entries(manifest.datasets)) {
    if (specPaths(spec).some((p) => matchesSpecPath(p, changed))) hit.add(name);
  }
  return [...hit];
}

type Listener = (event: RuntimeEvent) => void;

/** Fan-out for runtime events: every open SSE stream registers a listener. */
export class RuntimeEventBroadcaster {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get size(): number {
    return this.listeners.size;
  }
}

const broadcasters = new Map<string, RuntimeEventBroadcaster>();

/** The per-app event broadcaster — every SSE stream and watcher for an app shares one. */
export function broadcasterFor(appId: string): RuntimeEventBroadcaster {
  let b = broadcasters.get(appId);
  if (!b) {
    b = new RuntimeEventBroadcaster();
    broadcasters.set(appId, b);
  }
  return b;
}

/**
 * Maps a watched file change to the runtime events the clients need. A change
 * that breaks validation yields a `validation` event (the affected islands flip
 * to fail-loudly) instead of throwing; otherwise a `datasets-changed` event
 * tells the client which queries to invalidate. Returns an empty list when the
 * change touches no dataset.
 */
export async function eventsForChange(
  projectDir: string,
  changedRel: string,
): Promise<RuntimeEvent[]> {
  resetEngine(projectDir);
  if (isComponentChange(changedRel)) {
    resetCustomBuildCache();
    resetCustomSchemaCache();
  }
  const report = await compile(projectDir);
  if (!report.ok) {
    const failed = report.islandChecks.filter((c) => !c.ok);
    const errors: IslandValidationError[] = failed.flatMap((c) =>
      (c.missingFields.length ? c.missingFields : [undefined]).map((field) => ({
        page: c.page,
        index: c.index,
        type: c.type,
        field,
        message: field
          ? `missing field '${field}' in dataset '${c.dataset ?? ""}'`
          : `dataset '${c.dataset ?? ""}' is unavailable`,
      })),
    );
    if (errors.length === 0 && report.manifestErrors.length) errors.push(...report.manifestErrors);
    return [{ type: "validation", islandErrors: errors }];
  }
  if (isComponentChange(changedRel)) return [{ type: "components-changed" }];
  const datasets = report.manifest ? affectedDatasets(report.manifest, changedRel) : [];
  if (datasets.length === 0) return [];
  return [{ type: "datasets-changed", datasets }];
}

export interface WatchHandle {
  close: () => Promise<void>;
}

const watchHandles = new Map<string, Promise<WatchHandle>>();

/**
 * Starts an app's watcher once per process, lazily, when its first SSE client
 * connects — so the watcher and the broadcaster live in the same
 * (server-bundled) module instance, and only apps actually open in a browser
 * cost a watcher. A no-op for unknown apps (e.g. unit tests importing events.ts
 * without a workspace env).
 */
export function ensureWatcher(appId: string): void {
  if (watchHandles.has(appId)) return;
  let dir: string;
  try {
    dir = appDir(appId);
  } catch {
    return;
  }
  watchHandles.set(appId, startWatcher(dir, { broadcaster: broadcasterFor(appId) }));
  void import("./connectorScheduler.js")
    .then((m) => m.startConnectorScheduler(dir, broadcasterFor(appId)))
    .catch((e) => console.error(`[openislands] connector scheduler failed for '${appId}': ${(e as Error).message}`));
}

/**
 * Watches the project's data/models/app dirs and publishes runtime events to the
 * broadcaster on every change. Debounced so a burst of writes (an editor save,
 * a multi-file export) collapses into one recompile.
 */
export async function startWatcher(
  projectDir: string,
  opts: { broadcaster: RuntimeEventBroadcaster; debounceMs?: number },
): Promise<WatchHandle> {
  const { default: chokidar } = await import("chokidar");
  const debounceMs = opts.debounceMs ?? 120;
  const paths = WATCH_DIRS.map((d) => join(projectDir, d));
  const watcher: FSWatcher = chokidar.watch(paths, { ignoreInitial: true, persistent: true });

  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    timer = undefined;
    const changed = [...pending];
    pending.clear();
    const seen = new Set<string>();
    const events: RuntimeEvent[] = [];
    for (const abs of changed) {
      const rel = normRel(relative(projectDir, abs));
      for (const event of await eventsForChange(projectDir, rel)) {
        const key = JSON.stringify(event);
        if (seen.has(key)) continue;
        seen.add(key);
        events.push(event);
      }
    }
    for (const event of mergeEvents(events)) opts.broadcaster.publish(event);
  };

  const onChange = (abs: string) => {
    pending.add(abs);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), debounceMs);
  };

  watcher.on("add", onChange).on("change", onChange).on("unlink", onChange);
  await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));

  return {
    close: async () => {
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
}

/** Collapse a batch into at most one validation, one datasets-changed, and one components-changed event. */
export function mergeEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  const validation = events.find((e) => e.type === "validation");
  if (validation) return [validation];
  const out: RuntimeEvent[] = [];
  const datasets = new Set<string>();
  for (const e of events)
    if (e.type === "datasets-changed") for (const d of e.datasets) datasets.add(d);
  if (datasets.size > 0) out.push({ type: "datasets-changed", datasets: [...datasets] });
  if (events.some((e) => e.type === "components-changed")) out.push({ type: "components-changed" });
  return out;
}
