import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import type { Manifest, PageIcon } from "@openislands/schema";
import { scanCustomIslands } from "./custom.js";
import { loadManifest } from "./project.js";
import { appDir, listApps } from "./workspace.js";

export interface WorkspaceAppInfo {
  id: string;
  title: string;
  icon?: PageIcon;
  errorCount: number;
}

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];
type ConnectorEntry = NonNullable<Manifest["connectors"]>[string];

/**
 * The manifest as it crosses the SSR boundary. TanStack Start type-checks
 * server-fn returns for serializability; the manifest's free-form connector
 * `config` is typed `unknown` (it is validated against each connector's own
 * schema at load, not in the manifest schema), which trips that check even
 * though the value is always JSON at runtime. Presenting `config` as JSON here
 * satisfies the boundary without loosening the published manifest schema.
 */
export type DashboardManifest = Omit<Manifest, "connectors"> & {
  connectors?: Record<string, Omit<ConnectorEntry, "config"> & { config?: Record<string, JsonValue> }>;
};

export const getWorkspace = createServerFn({ method: "GET" }).handler(
  (): WorkspaceAppInfo[] =>
    listApps().map(({ id, title, icon, errors }) => ({ id, title, icon, errorCount: errors.length })),
);

export const getDashboard = createServerFn({ method: "GET" })
  .validator((data: { appId: string }) => data)
  .handler(async ({ data }) => {
    let dir: string;
    try {
      dir = appDir(data.appId);
    } catch {
      throw notFound();
    }
    const { manifest, errors } = loadManifest(dir);
    const customIslands = await scanCustomIslands(dir);
    return { manifest: manifest as DashboardManifest, manifestErrors: errors, customIslands };
  });
