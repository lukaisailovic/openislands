import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Manifest, validateManifest } from "@openislands/schema";

export interface LoadedManifest {
  manifest: Manifest;
  errors: { page: string; index: number; type: string; field?: string; message: string }[];
}

/**
 * Read and validate the project's manifest server-side. A failed read or an
 * invalid manifest is not a crash: errors flow to the UI so the page still
 * renders and tells the user what their agent must fix.
 */
export function loadManifest(dir: string): LoadedManifest {
  const path = join(dir, "app", "manifest.json");
  if (!existsSync(path)) {
    return {
      manifest: { version: 1, title: "OpenIslands", datasets: {}, pages: [] },
      errors: [{ page: "-", index: -1, type: "-", message: `no manifest at ${path}` }],
    };
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const result = validateManifest(raw);
  if (!result.ok || !result.manifest) {
    return {
      manifest: { version: 1, title: "OpenIslands", datasets: {}, pages: [] },
      errors: result.errors,
    };
  }
  return { manifest: result.manifest, errors: [] };
}
