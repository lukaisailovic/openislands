/**
 * Workspace app discovery — the one scan the CLI, runtime, and MCP share. A
 * project is a workspace rooted at a dir; apps live under `<root>/apps/<id>/`,
 * each holding a `manifest.json`. Discovery runs every pending layout migration
 * on each candidate before deciding it's an app, so a legacy `app/manifest.json`
 * project is transparently upgraded the moment any surface scans it.
 *
 * Two levels: `discoverApps` is the raw set (every app with a manifest,
 * alphabetical); `scanWorkspaceApps` layers the `openislands.json` order +
 * `hidden` config on top. Kept on raw `node:fs` — the same structural level the
 * callers' registries already work at, outside the content port.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { migrateApp } from "./migrate.js";

export interface AppRef {
  id: string;
  dir: string;
}

export interface WorkspaceConfig {
  order?: string[];
  hidden?: string[];
}

/** An app id must be a single safe path segment (it is also a URL segment). */
export function isSafeAppId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

export function readWorkspaceConfig(root: string): WorkspaceConfig {
  const path = join(root, "openislands.json");
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return {
      order: Array.isArray(raw.order) ? raw.order.filter((v): v is string => typeof v === "string") : undefined,
      hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((v): v is string => typeof v === "string") : undefined,
    };
  } catch {
    return {};
  }
}

/** Every app dir under `<root>/apps` that holds a manifest (migrated to the current layout first), alphabetical. */
export function discoverApps(root: string): AppRef[] {
  const appsDir = join(root, "apps");
  if (!existsSync(appsDir)) return [];
  const candidates = readdirSync(appsDir, { withFileTypes: true }).filter(
    (d) => d.isDirectory() && isSafeAppId(d.name),
  );
  for (const d of candidates) migrateApp(join(appsDir, d.name));
  return candidates
    .filter((d) => existsSync(join(appsDir, d.name, "manifest.json")))
    .map((d) => ({ id: d.name, dir: join(appsDir, d.name) }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
}

/** {@link discoverApps} with `openislands.json` order applied and `hidden` apps removed. */
export function scanWorkspaceApps(root: string): AppRef[] {
  const config = readWorkspaceConfig(root);
  const hidden = new Set(config.hidden ?? []);
  const rank = new Map((config.order ?? []).map((id, i) => [id, i]));
  return discoverApps(root)
    .filter((app) => !hidden.has(app.id))
    .toSorted((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a.id.localeCompare(b.id);
    });
}
