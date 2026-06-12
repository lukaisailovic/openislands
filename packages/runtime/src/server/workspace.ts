/**
 * The workspace registry: which apps this process serves. A workspace is either
 * a single project (`OPENISLANDS_PROJECT_DIR`) or a directory of projects
 * (`OPENISLANDS_WORKSPACE_DIR`) whose immediate subdirectories each hold an
 * `app/manifest.json`. The registry is derived live from disk on every request
 * (behind a short TTL) — adding an app directory shows up on the next page load
 * without a restart, matching the live-everywhere runtime philosophy.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { PageIcon } from "@openislands/schema";
import { type LoadedManifest, loadManifest } from "./project.js";

export interface WorkspaceApp {
  id: string;
  dir: string;
  title: string;
  icon?: PageIcon;
  /** manifest-level errors — the app still gets a rail tile, in an error state */
  errors: LoadedManifest["errors"];
}

export interface WorkspaceConfig {
  order?: string[];
  hidden?: string[];
}

const SCAN_TTL_MS = 1_000;

export function workspaceRoot(): { mode: "single" | "multi"; dir: string } {
  const single = process.env.OPENISLANDS_PROJECT_DIR;
  if (single) return { mode: "single", dir: single };
  const multi = process.env.OPENISLANDS_WORKSPACE_DIR;
  if (multi) return { mode: "multi", dir: multi };
  throw new Error(
    "neither OPENISLANDS_PROJECT_DIR nor OPENISLANDS_WORKSPACE_DIR is set — the runtime must be booted by `openislands serve`",
  );
}

/** An app id must be a single safe path segment (it is also a URL segment). */
export function isSafeAppId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

function sanitizeAppId(name: string): string {
  const id = name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[._-]+/, "");
  return id || "app";
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

function appFrom(id: string, dir: string): WorkspaceApp {
  const { manifest, errors } = loadManifest(dir);
  return { id, dir, title: manifest.title, icon: manifest.icon, errors };
}

/** Project subdirectory names in the workspace, ordered by config then alphabetically. */
export function scanWorkspaceApps(root: string): { id: string; dir: string }[] {
  const config = readWorkspaceConfig(root);
  const hidden = new Set(config.hidden ?? []);
  const found = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isSafeAppId(d.name) && !hidden.has(d.name))
    .filter((d) => existsSync(join(root, d.name, "app", "manifest.json")))
    .map((d) => ({ id: d.name, dir: join(root, d.name) }));

  const rank = new Map((config.order ?? []).map((id, i) => [id, i]));
  return found.toSorted((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra !== rb ? ra - rb : a.id.localeCompare(b.id);
  });
}

let scanCache: { key: string; at: number; apps: WorkspaceApp[] } | undefined;

export function listApps(): WorkspaceApp[] {
  const { mode, dir } = workspaceRoot();
  const key = `${mode}:${dir}`;
  if (scanCache && scanCache.key === key && Date.now() - scanCache.at < SCAN_TTL_MS) {
    return scanCache.apps;
  }
  const apps =
    mode === "single"
      ? [appFrom(sanitizeAppId(basename(dir)), dir)]
      : scanWorkspaceApps(dir).map((found) => appFrom(found.id, found.dir));
  scanCache = { key, at: Date.now(), apps };
  return apps;
}

/** Resolve an app id to its project directory. Throws on unknown ids (404-able). */
export function appDir(appId: string): string {
  const app = listApps().find((a) => a.id === appId);
  if (!app) throw new Error(`unknown app '${appId}'`);
  return app.dir;
}

export function resetWorkspaceCache(): void {
  scanCache = undefined;
}

export type AppResolution =
  | { ok: true; dir: string; appId: string }
  | { ok: false; status: number; error: string };

/** Resolve the `app` search param (GET URL or POST body) to a project dir. */
export function appDirFromParams(params: URLSearchParams): AppResolution {
  const appId = params.get("app");
  if (!appId) return { ok: false, status: 400, error: "missing 'app'" };
  try {
    return { ok: true, dir: appDir(appId), appId };
  } catch {
    return { ok: false, status: 404, error: `unknown app '${appId}'` };
  }
}
