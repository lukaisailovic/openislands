#!/usr/bin/env node
/**
 * End-to-end smoke test for the published surface: per template, `init` into a
 * temp dir, `serve` it, and assert the dashboard SSRs (HTML contains the manifest
 * title) and `/api/query?dataset=<dataset>` answers 200 with rows.
 *
 * Plain Node, no test framework. Fails loudly with the captured server output and
 * always kills the server it started — even on assertion failure or timeout.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repoRoot, "packages", "cli", "src", "index.ts");

/** A representative tabular dataset per template (not a markdown/doc source). */
const TEMPLATES = [
  { template: "finance", dataset: "net_worth_monthly" },
  { template: "health", dataset: "weight" },
  { template: "operations", dataset: "throughput" },
];

function manifestTitle(template) {
  const manifest = join(repoRoot, "templates", template, "app", "manifest.json");
  return JSON.parse(readFileSync(manifest, "utf8")).title;
}

const BOOT_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

function run(args, opts = {}) {
  return spawn("node_modules/.bin/tsx", [cli, ...args], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group so kill() reaps tsx *and* the node child it spawns.
    detached: true,
    ...opts,
  });
}

function randomPort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function init(template, dir) {
  return new Promise((resolve, reject) => {
    const proc = run(["init", dir, "--template", template]);
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`init ${template} exited ${code}\n${err}`)),
    );
  });
}

/** Boots `serve`, resolves once the listening line is printed, rejects on early exit. */
function startServer(dir, port) {
  const proc = run(["serve", dir, "--port", String(port)]);
  let out = "";
  const log = () => out;
  const ready = new Promise((resolve, reject) => {
    const onData = (d) => {
      out += d;
      if (out.includes("OpenIslands runtime")) resolve();
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", (d) => (out += d));
    proc.on("exit", (code) => reject(new Error(`serve exited early (code ${code})\n${out}`)));
  });
  return { proc, ready, log };
}

function kill(proc) {
  if (!proc || proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;
  // Negative pid targets the whole process group (tsx + its node child).
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    proc.kill("SIGKILL");
  }
}

async function check({ template, dataset }) {
  const title = manifestTitle(template);
  const dir = mkdtempSync(join(tmpdir(), `openislands-e2e-${template}-`));
  const port = randomPort();
  let server;
  try {
    await init(template, dir);
    server = startServer(dir, port);
    await withTimeout(server.ready, BOOT_TIMEOUT_MS, `${template} serve boot`);
    const base = `http://127.0.0.1:${port}`;

    const html = await withTimeout(
      fetch(base).then((r) => {
        if (!r.ok) throw new Error(`GET / → ${r.status}`);
        return r.text();
      }),
      REQUEST_TIMEOUT_MS,
      `${template} GET /`,
    );
    if (!html.includes(title)) {
      throw new Error(`dashboard HTML did not contain title "${title}"`);
    }

    const query = await withTimeout(
      fetch(`${base}/api/query?dataset=${dataset}`).then(async (r) => {
        const body = await r.json();
        if (r.status !== 200) throw new Error(`/api/query → ${r.status}: ${JSON.stringify(body)}`);
        return body;
      }),
      REQUEST_TIMEOUT_MS,
      `${template} /api/query`,
    );
    if (!Array.isArray(query.rows) || query.rows.length === 0) {
      throw new Error(`/api/query?dataset=${dataset} returned no rows`);
    }

    console.log(
      `  ✓ ${template}: HTML title ok, ${dataset} → ${query.rows.length} row(s)`,
    );
  } catch (err) {
    if (server) console.error(`\n--- ${template} server output ---\n${server.log()}\n---`);
    throw err;
  } finally {
    if (server) kill(server.proc);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log(`e2e: ${TEMPLATES.length} template(s)\n`);
  for (const t of TEMPLATES) {
    await check(t);
  }
  console.log("\ne2e: all templates passed");
}

main().catch((err) => {
  console.error(`\ne2e failed: ${err.message}`);
  process.exit(1);
});
