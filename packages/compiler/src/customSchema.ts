/**
 * Custom-island schema validation — the typed extension point's safety net.
 *
 * A user project may register a custom island under
 * `components/custom/<type>/` (the directory name IS the island type). When that
 * directory ships a `schema.ts` (default-exporting a Zod object), the compiler
 * validates the island's manifest config against it with the same machinery that
 * guards the built-ins: a bad config is a named compile error, not a silent
 * placeholder. No schema file → the island is accepted as custom, unchecked.
 *
 * User projects have no node_modules and no build step, so the schema is bundled
 * at validate time with esbuild — `zod` resolved from the compiler's own
 * dependency so the user never installs anything — then imported from a temp file.
 */
import { mkdtempSync, existsSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { z } from "zod";

const require = createRequire(import.meta.url);

const SCHEMA_FILENAMES = ["schema.ts", "schema.mts", "schema.js", "schema.mjs"];

export function customIslandDir(projectDir: string, type: string): string {
  return join(projectDir, "components", "custom", type);
}

export function customSchemaFile(projectDir: string, type: string): string | null {
  const dir = customIslandDir(projectDir, type);
  for (const name of SCHEMA_FILENAMES) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Absolute path to the exact zod the compiler runs, aliased into the user's bundle. */
function zodEntryPath(): string {
  return require.resolve("zod");
}

interface CompiledSchema {
  schema: z.ZodType;
  mtimeMs: number;
}

const cache = new Map<string, CompiledSchema>();

async function loadSchema(schemaPath: string): Promise<z.ZodType> {
  const mtimeMs = statSync(schemaPath).mtimeMs;
  const cached = cache.get(schemaPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.schema;

  const result = await build({
    entryPoints: [schemaPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    alias: { zod: zodEntryPath() },
  });
  const code = result.outputFiles[0]!.text;
  const outDir = mkdtempSync(join(tmpdir(), "openislands-schema-"));
  const outFile = join(outDir, "schema.mjs");
  writeFileSync(outFile, code);

  const mod = (await import(pathToFileURL(outFile).href)) as { default?: unknown };
  const schema = mod.default;
  if (!(schema instanceof z.ZodType)) {
    throw new Error(`${schemaPath} must default-export a Zod schema`);
  }
  cache.set(schemaPath, { schema, mtimeMs });
  return schema;
}

export interface CustomIslandError {
  type: string;
  field?: string;
  message: string;
}

/**
 * Validate one custom island's config against its `schema.ts`, if present.
 * Returns the named errors (empty when valid or when no schema file exists).
 * Throws only if the schema file itself is broken (bad default export, bundling
 * failure) — that is the author's bug, surfaced loudly.
 */
export async function checkCustomIsland(
  projectDir: string,
  type: string,
  config: Record<string, unknown>,
): Promise<CustomIslandError[]> {
  const schemaPath = customSchemaFile(projectDir, type);
  if (!schemaPath) return [];
  const schema = await loadSchema(schemaPath);
  const result = schema.safeParse(config);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return { type, field: path || undefined, message: path ? `${path}: ${issue.message}` : issue.message };
  });
}

export function resetCustomSchemaCache(): void {
  cache.clear();
}
