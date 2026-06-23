#!/usr/bin/env node
/**
 * Validate every template under templates/ — each immediate subdirectory that
 * holds at least one app under apps/<id>/app/manifest.json. Dynamic, so a newly
 * added template is covered the moment it lands, with no hardcoded list to keep
 * in sync.
 *
 * Mirrors scripts/e2e.mjs: spawns the real CLI through tsx so validation behaves
 * exactly as it does for a user. `validate` runs at the project root and fans out
 * across the project's apps itself. Runs every template (doesn't stop at the first
 * failure) so one broken template doesn't hide others, then exits non-zero if any
 * failed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repoRoot, "packages", "cli", "src", "index.ts");
const templatesDir = join(repoRoot, "templates");

function hasApp(templateDir) {
  const appsDir = join(templateDir, "apps");
  if (!existsSync(appsDir)) return false;
  return readdirSync(appsDir, { withFileTypes: true }).some(
    (d) => d.isDirectory() && existsSync(join(appsDir, d.name, "app", "manifest.json")),
  );
}

const templates = readdirSync(templatesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && hasApp(join(templatesDir, d.name)))
  .map((d) => d.name)
  .toSorted();

if (templates.length === 0) {
  console.error("no templates found under templates/ (expected subdirectories with apps/<id>/app/manifest.json)");
  process.exit(1);
}

console.log(`validating ${templates.length} template(s): ${templates.join(", ")}\n`);

const failed = templates.filter(
  (name) =>
    spawnSync("node_modules/.bin/tsx", [cli, "validate", join(templatesDir, name)], {
      cwd: repoRoot,
      stdio: "inherit",
    }).status !== 0,
);

if (failed.length > 0) {
  console.error(`\n✗ ${failed.length} template(s) failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\n✓ all ${templates.length} template(s) valid`);
