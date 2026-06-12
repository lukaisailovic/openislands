import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import type { PageIcon } from "@openislands/schema";
import { scanCustomIslands } from "./custom.js";
import { loadManifest } from "./project.js";
import { appDir, listApps } from "./workspace.js";

export interface WorkspaceAppInfo {
  id: string;
  title: string;
  icon?: PageIcon;
  errorCount: number;
}

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
    return { manifest, manifestErrors: errors, customIslands };
  });
