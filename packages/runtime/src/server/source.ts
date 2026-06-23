import { getContentStore, isHiddenPath, resolveWithinRoot } from "@openislands/storage";
import { loadManifest } from "./project.js";

export interface DatasetSqlResult {
  status: number;
  body: { sql: string } | { error: string };
}

/**
 * Read a transform's SQL text, resolved from the manifest by dataset name —
 * never from a client-supplied path. The dataset must exist and declare a
 * `sql` transform, and the resolved file must stay under the project root and
 * clear the dotfile/secret denylist — so a manifest whose `sql` pointer is
 * crafted to read `.env` or `.openislands/connectors/*.json` can't disclose it.
 */
export async function readDatasetSql(projectDir: string, dataset: string): Promise<DatasetSqlResult> {
  if (!dataset) return { status: 400, body: { error: "missing 'dataset'" } };

  const spec = loadManifest(projectDir).manifest.datasets[dataset];
  if (!spec) return { status: 404, body: { error: `unknown dataset '${dataset}'` } };
  if (!spec.sql) return { status: 404, body: { error: `'${dataset}' is not a transform` } };

  const confined = resolveWithinRoot(projectDir, spec.sql);
  if (!confined) return { status: 403, body: { error: "transform path escapes the project root" } };
  if (isHiddenPath(confined.rel)) return { status: 403, body: { error: "transform path targets a protected file" } };

  const sql = await getContentStore(projectDir).readText(confined.abs);
  if (sql === null) return { status: 404, body: { error: `transform file not found for '${dataset}'` } };
  return { status: 200, body: { sql } };
}
