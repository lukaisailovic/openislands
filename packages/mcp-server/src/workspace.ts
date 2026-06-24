/**
 * Workspace app discovery for the MCP server. A project is a workspace rooted at
 * the dir passed to {@link createServer}; apps live under `<root>/apps/<id>/`, each
 * holding a `manifest.json`. This mirrors the runtime's scan (order from
 * `<root>/openislands.json`, then alphabetical, `hidden` filtered) but stays local
 * so the MCP server doesn't take a dependency on `@openislands/runtime`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { migrateApp } from "@openislands/compiler";

export interface ScannedApp {
  id: string;
  dir: string;
}

interface WorkspaceConfig {
  order?: string[];
  hidden?: string[];
}

/** An app id must be a single safe path segment (it is also a URL segment). */
export function isSafeAppId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

function readWorkspaceConfig(root: string): WorkspaceConfig {
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

/** App subdirectories under `<root>/apps`, ordered by `openislands.json` then alphabetically. */
export function scanApps(root: string): ScannedApp[] {
  const appsDir = join(root, "apps");
  if (!existsSync(appsDir)) return [];
  const config = readWorkspaceConfig(root);
  const hidden = new Set(config.hidden ?? []);
  const candidates = readdirSync(appsDir, { withFileTypes: true }).filter(
    (d) => d.isDirectory() && isSafeAppId(d.name) && !hidden.has(d.name),
  );
  for (const d of candidates) migrateApp(join(appsDir, d.name));
  const found = candidates
    .filter((d) => existsSync(join(appsDir, d.name, "manifest.json")))
    .map((d) => ({ id: d.name, dir: join(appsDir, d.name) }));

  const rank = new Map((config.order ?? []).map((id, i) => [id, i]));
  return found.toSorted((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra !== rb ? ra - rb : a.id.localeCompare(b.id);
  });
}
