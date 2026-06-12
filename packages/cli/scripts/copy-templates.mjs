#!/usr/bin/env node
/**
 * Bundle the repo's templates next to the built CLI so a published, cold
 * `npx openislands init` finds them. templatesDir() resolves `../templates`
 * relative to dist/index.mjs, which lands here at packages/cli/templates.
 *
 * Transient runtime artifacts (history snapshots, installed deps) are skipped so
 * they never ship in the tarball.
 */
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(cliDir, "..", "..");
const src = join(repoRoot, "templates");
const dest = join(cliDir, "templates");

const SKIP = new Set([".openislands", "node_modules", "dist"]);

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, {
  recursive: true,
  filter: (from) => !SKIP.has(from.split("/").pop()),
});
console.log(`copied templates → ${dest}`);
