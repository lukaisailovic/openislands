import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { getContentStore } from "@openislands/storage";
import { loadManifest } from "./project.js";

export interface DatasetSqlResult {
  status: number;
  body: { sql: string } | { error: string };
}

/**
 * Read a transform's SQL text, resolved from the manifest by dataset name —
 * never from a client-supplied path. The dataset must exist and declare a
 * `sql` transform, and the resolved file must stay under the project root.
 */
export async function readDatasetSql(projectDir: string, dataset: string): Promise<DatasetSqlResult> {
  if (!dataset) return { status: 400, body: { error: "missing 'dataset'" } };

  const spec = loadManifest(projectDir).manifest.datasets[dataset];
  if (!spec) return { status: 404, body: { error: `unknown dataset '${dataset}'` } };
  if (!spec.sql) return { status: 404, body: { error: `'${dataset}' is not a transform` } };

  let root = resolve(projectDir);
  try {
    root = realpathSync(root);
  } catch {
    /* a not-yet-real root still resolves the relative path below */
  }
  const abs = isAbsolute(spec.sql) ? resolve(spec.sql) : resolve(root, spec.sql);
  const within = relative(root, abs);
  if (within.startsWith("..") || isAbsolute(within)) {
    return { status: 403, body: { error: "transform path escapes the project root" } };
  }

  const sql = await getContentStore(projectDir).readText(abs);
  if (sql === null) return { status: 404, body: { error: `transform file not found for '${dataset}'` } };
  return { status: 200, body: { sql } };
}
