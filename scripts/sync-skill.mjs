#!/usr/bin/env node
/**
 * Single source of truth → every template. Copies the canonical OpenIslands agent skill
 * (skills/openislands/) into each template's .agents/skills/openislands/, plus the shared
 * .mcp.json and AGENTS.md (from scripts/template-files/), so a freshly scaffolded project is
 * agent-ready out of the box. Run via `pnpm sync:skill`; validate:templates depends on it so
 * the committed copies can never drift from the source.
 */
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillSrc = join(repoRoot, "skills", "openislands");
const sharedDir = join(repoRoot, "scripts", "template-files");
const templatesDir = join(repoRoot, "templates");

const templates = readdirSync(templatesDir).filter((name) => statSync(join(templatesDir, name)).isDirectory());

for (const template of templates) {
  const dir = join(templatesDir, template);
  const skillDest = join(dir, ".agents", "skills", "openislands");
  rmSync(skillDest, { recursive: true, force: true });
  mkdirSync(dirname(skillDest), { recursive: true });
  cpSync(skillSrc, skillDest, { recursive: true });
  cpSync(join(sharedDir, ".mcp.json"), join(dir, ".mcp.json"));
  cpSync(join(sharedDir, "AGENTS.md"), join(dir, "AGENTS.md"));
  console.log(`synced agent files → templates/${template}`);
}

console.log(`✓ synced skill + .mcp.json + AGENTS.md into ${templates.length} templates`);
