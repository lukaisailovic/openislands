/**
 * Connectors — vendored integrations that sync provider data into a project's
 * `source` datasets. The connector code lives in the user project at
 * `<module>/index.ts` (dir name = connector name, mirroring custom islands); the
 * compiler bundles and loads it with esbuild (no project node_modules), hands
 * its `sync` a context wired to the checkpointed write path, and persists tokens
 * + cursor state at `.openislands/connectors/<name>.json`.
 *
 * Auth is per-scheme (see the auth-scheme helpers below): keyless (declared
 * `secrets` only), OAuth2 authorization-code, or a static bearer token read from
 * `.env`. No provider special-casing. Writes reuse the actions insert/replace
 * core, so `rollback` covers connector data exactly like manifest edits and
 * action writes.
 */
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { build } from "esbuild";
import ms from "ms";
import type {
  ConnectorAuth,
  ConnectorContext,
  ConnectorDefinition,
  ConnectorTokens,
  OAuth2AuthData,
} from "@openislands/connector-kit";
import type { ConnectorSpec, Manifest } from "@openislands/schema";
import { getAppStateStore } from "@openislands/storage";
import { readManifest, resolveSourcePath, type WriteTarget } from "./index.js";
import {
  insertValidatedRows,
  replaceValidatedRows,
  datasetRowSchema,
  type RetentionOpts,
} from "./actions.js";

const require = createRequire(import.meta.url);

// --- Module loading (esbuild bundle → import) -----------------------------------

const ENTRY_FILENAMES = ["index.ts", "index.tsx", "index.mts", "index.js", "index.mjs"];

function connectorDir(projectDir: string, spec: ConnectorSpec): string {
  return resolveSourcePath(projectDir, spec.module);
}

function connectorEntry(projectDir: string, spec: ConnectorSpec): string | null {
  const dir = connectorDir(projectDir, spec);
  for (const name of ENTRY_FILENAMES) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

interface LoadedModule {
  def: ConnectorDefinition;
  mtimeMs: number;
}

const moduleCache = new Map<string, LoadedModule>();

/** Aliases the bundle's `zod` + `@openislands/connector-kit` imports to the exact copies the compiler runs, so the user project installs nothing. */
function bundleAliases(): Record<string, string> {
  return {
    zod: require.resolve("zod"),
    "@openislands/connector-kit": require.resolve("@openislands/connector-kit"),
  };
}

async function loadConnector(projectDir: string, spec: ConnectorSpec): Promise<ConnectorDefinition> {
  const dir = connectorDir(projectDir, spec);
  if (!existsSync(dir)) throw new Error(`connector module directory not found: ${spec.module}`);
  const entry = connectorEntry(projectDir, spec);
  if (!entry) throw new Error(`connector module '${spec.module}' has no index.{ts,tsx,mts,js,mjs}`);

  const mtimeMs = statSync(entry).mtimeMs;
  const cached = moduleCache.get(entry);
  if (cached && cached.mtimeMs === mtimeMs) return cached.def;

  let code: string;
  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      alias: bundleAliases(),
    });
    code = result.outputFiles[0]!.text;
  } catch (e) {
    throw new Error(`failed to bundle connector '${spec.module}': ${(e as Error).message}`, { cause: e });
  }

  const outDir = mkdtempSync(join(tmpdir(), "openislands-connector-"));
  const outFile = join(outDir, "connector.mjs");
  writeFileSync(outFile, code);
  const mod = (await import(pathToFileURL(outFile).href)) as { default?: unknown };
  const def = mod.default as ConnectorDefinition | undefined;
  if (!def || typeof def.sync !== "function" || typeof def.outputs !== "object") {
    throw new Error(`connector '${spec.module}' must default-export defineConnector({ ... })`);
  }
  moduleCache.set(entry, { def, mtimeMs });
  return def;
}

export function resetConnectorCache(): void {
  moduleCache.clear();
}

// --- Env + state store ----------------------------------------------------------

function loadEnv(projectDir: string): void {
  const envPath = join(projectDir, ".env");
  if (!existsSync(envPath)) return;
  process.loadEnvFile(envPath);
}

interface PendingOAuth {
  state: string;
  redirectUri: string;
}

interface ConnectorState {
  tokens?: ConnectorTokens;
  state?: Record<string, unknown>;
  lastSync?: string;
  lastError?: string;
  pendingOAuth?: PendingOAuth;
}

function stateKey(name: string): string {
  return `connectors/${name}.json`;
}

async function readState(projectDir: string, name: string): Promise<ConnectorState> {
  const raw = await getAppStateStore(projectDir).getText(stateKey(name));
  return raw === null ? {} : (JSON.parse(raw) as ConnectorState);
}

async function writeState(projectDir: string, name: string, state: ConnectorState): Promise<void> {
  await getAppStateStore(projectDir).put(stateKey(name), `${JSON.stringify(state, null, 2)}\n`);
}

/** Whether this project has a pending OAuth flow for the connector matching `state` — lets a shared callback route find which workspace app started the flow. */
export async function hasPendingOAuthState(projectDir: string, name: string, state: string): Promise<boolean> {
  return (await readState(projectDir, name)).pendingOAuth?.state === state;
}

// --- Manifest lookup + schedule -------------------------------------------------

function lookupConnector(manifest: Manifest, name: string): ConnectorSpec {
  const spec = manifest.connectors?.[name];
  if (!spec) throw new Error(`unknown connector '${name}'`);
  return spec;
}

/** Load .env, find the named connector's spec, and load its module — the shared prelude of every connector operation. */
async function resolveConnector(projectDir: string, name: string): Promise<{ spec: ConnectorSpec; def: ConnectorDefinition }> {
  loadEnv(projectDir);
  const spec = lookupConnector(await readManifest(projectDir), name);
  const def = await loadConnector(projectDir, spec);
  return { spec, def };
}

function requireOAuth(name: string, def: ConnectorDefinition): OAuth2AuthData {
  if (def.auth?.type !== "oauth2") throw new Error(`connector '${name}' is not an oauth2 connector`);
  return def.auth.data;
}

/** Reads the OAuth client credentials from env, throwing if either is unset. */
function requireClientCredentials(auth: OAuth2AuthData): { clientId: string; clientSecret: string } {
  const clientId = process.env[auth.clientIdEnv];
  const clientSecret = process.env[auth.clientSecretEnv];
  if (!clientId || !clientSecret) throw new Error(`missing ${auth.clientIdEnv}/${auth.clientSecretEnv} in env`);
  return { clientId, clientSecret };
}

function effectiveSchedule(spec: ConnectorSpec, def: ConnectorDefinition | undefined): string | undefined {
  return spec.schedule ?? def?.schedule;
}

/** Parse a schedule string ("6h", "30m", "1d", or ms-style) into milliseconds; throws on an invalid value. */
export function parseSchedule(schedule: string): number {
  const parsed = ms(schedule as ms.StringValue);
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid schedule '${schedule}' — use '<n>m|h|d' (e.g. 6h)`);
  }
  return parsed;
}

// --- Auth schemes ---------------------------------------------------------------
// One small surface per auth kind so the engine never branches on `auth.type`
// inline: keyless reads only declared `secrets`, oauth2 persists tokens, bearer
// reads a static token from `.env` and hands it to sync exactly like an OAuth one.

type AuthKind = "none" | "oauth2" | "bearer";

function authKind(def: ConnectorDefinition | undefined): AuthKind {
  return def?.auth?.type ?? "none";
}

/** Env keys that must be present for this scheme to be usable, besides declared `secrets`. */
function authEnvKeys(auth: ConnectorAuth | undefined): string[] {
  if (!auth) return [];
  if (auth.type === "oauth2") return [auth.data.clientIdEnv, auth.data.clientSecretEnv];
  return [auth.data.tokenEnv]; // bearer
}

/** Is the connector connected right now, given persisted state + env? (Caller handles the keyless case.) */
function isAuthConnected(auth: ConnectorAuth, persisted: ConnectorState): boolean {
  if (auth.type === "oauth2") return !!persisted.tokens?.accessToken;
  return !!process.env[auth.data.tokenEnv]; // bearer
}

function readSecrets(def: ConnectorDefinition | undefined): { secrets: Record<string, string>; missing: string[] } {
  const secrets: Record<string, string> = {};
  const missing: string[] = [];
  const keys = [...(def?.secrets ?? []), ...authEnvKeys(def?.auth)];
  for (const key of keys) {
    const value = process.env[key];
    if (value === undefined || value === "") {
      if (!missing.includes(key)) missing.push(key);
    } else secrets[key] = value;
  }
  return { secrets, missing };
}

// --- Status ---------------------------------------------------------------------

export interface ConnectorStatus {
  name: string;
  module: string;
  description?: string;
  schedule?: string;
  datasets: Record<string, string>;
  auth: "none" | "oauth2" | "bearer";
  connected: boolean;
  missingSecrets: string[];
  lastSync?: string;
  lastError?: string;
  loadError?: string;
}

export async function listConnectorStatuses(projectDir: string): Promise<ConnectorStatus[]> {
  loadEnv(projectDir);
  const manifest = await readManifest(projectDir);
  const entries = Object.entries(manifest.connectors ?? {});
  const statuses: ConnectorStatus[] = [];
  for (const [name, spec] of entries) {
    const persisted = await readState(projectDir, name);
    let def: ConnectorDefinition | undefined;
    let loadError: string | undefined;
    try {
      def = await loadConnector(projectDir, spec);
    } catch (e) {
      loadError = (e as Error).message;
    }
    const { missing } = readSecrets(def);
    const auth = authKind(def);
    const connected = auth === "none" ? missing.length === 0 : isAuthConnected(def!.auth!, persisted);
    statuses.push({
      name,
      module: spec.module,
      description: spec.description ?? def?.description,
      schedule: effectiveSchedule(spec, def),
      datasets: spec.datasets,
      auth,
      connected,
      missingSecrets: missing,
      lastSync: persisted.lastSync,
      lastError: persisted.lastError,
      loadError,
    });
  }
  return statuses;
}

// --- OAuth2 ---------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function tokensFromResponse(body: TokenResponse, prior?: ConnectorTokens): ConnectorTokens {
  const expiresAt = body.expires_in
    ? new Date(Date.now() + body.expires_in * 1000).toISOString()
    : undefined;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? prior?.refreshToken,
    expiresAt,
  };
}

async function postToken(auth: OAuth2AuthData, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(auth.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function getConnectorAuthorizeUrl(projectDir: string, name: string, redirectUri: string): Promise<string> {
  const { def } = await resolveConnector(projectDir, name);
  const auth = requireOAuth(name, def);
  const clientId = process.env[auth.clientIdEnv];
  if (!clientId) throw new Error(`missing ${auth.clientIdEnv} in env — set it in .env`);

  const oauthState = randomBytes(16).toString("hex");
  const persisted = await readState(projectDir, name);
  persisted.pendingOAuth = { state: oauthState, redirectUri };
  await writeState(projectDir, name, persisted);

  const url = new URL(auth.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", oauthState);
  if (auth.scopes?.length) url.searchParams.set("scope", auth.scopes.join(" "));
  return url.toString();
}

export async function completeConnectorOAuth(
  projectDir: string,
  name: string,
  params: { code: string; state: string; redirectUri: string },
): Promise<void> {
  const { def } = await resolveConnector(projectDir, name);
  const auth = requireOAuth(name, def);

  const persisted = await readState(projectDir, name);
  const pending = persisted.pendingOAuth;
  if (!pending || pending.state !== params.state) {
    throw new Error("oauth state mismatch — restart the connect flow");
  }
  const { clientId, clientSecret } = requireClientCredentials(auth);

  const body = await postToken(auth, {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  persisted.tokens = tokensFromResponse(body);
  delete persisted.pendingOAuth;
  delete persisted.lastError;
  await writeState(projectDir, name, persisted);
}

export async function disconnectConnector(projectDir: string, name: string): Promise<void> {
  const manifest = await readManifest(projectDir);
  lookupConnector(manifest, name);
  const persisted = await readState(projectDir, name);
  delete persisted.tokens;
  delete persisted.pendingOAuth;
  await writeState(projectDir, name, persisted);
}

const TOKEN_REFRESH_WINDOW_MS = 60_000;

async function refreshIfExpiring(
  projectDir: string,
  name: string,
  auth: OAuth2AuthData,
  tokens: ConnectorTokens,
): Promise<ConnectorTokens> {
  if (!tokens.expiresAt || !tokens.refreshToken) return tokens;
  if (Date.parse(tokens.expiresAt) - Date.now() > TOKEN_REFRESH_WINDOW_MS) return tokens;

  const { clientId, clientSecret } = requireClientCredentials(auth);
  const body = await postToken(auth, {
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const refreshed = tokensFromResponse(body, tokens);
  const persisted = await readState(projectDir, name);
  persisted.tokens = refreshed;
  await writeState(projectDir, name, persisted);
  return refreshed;
}

// --- Sync -----------------------------------------------------------------------

export interface SyncResult {
  connector: string;
  datasets: Record<string, { mode: "insert" | "replace"; rows: number; checkpoint_id?: string }>;
  durationMs: number;
}

const inFlight = new Map<string, Promise<SyncResult>>();

/** Resolve the tokens handed to `sync` per auth scheme: oauth2 refreshes its persisted token, bearer reads it from env, keyless gets none. */
async function resolveTokensForSync(
  projectDir: string,
  name: string,
  def: ConnectorDefinition,
  persisted: ConnectorState,
): Promise<ConnectorTokens | undefined> {
  const auth = def.auth;
  if (!auth) return undefined;
  if (auth.type === "bearer") {
    const token = process.env[auth.data.tokenEnv];
    if (!token) throw new Error(`connector '${name}' is not connected — set ${auth.data.tokenEnv} in .env`);
    return { accessToken: token };
  }
  let tokens = persisted.tokens;
  if (tokens) tokens = await refreshIfExpiring(projectDir, name, auth.data, tokens);
  if (!tokens?.accessToken) throw new Error(`connector '${name}' is not connected — open the dashboard and click Connect`);
  return tokens;
}

function resolveOutputDataset(spec: ConnectorSpec, def: ConnectorDefinition, output: string): string {
  if (!(output in def.outputs)) {
    throw new Error(`connector output '${output}' is not declared in the connector's outputs`);
  }
  const dataset = spec.datasets[output];
  if (!dataset) throw new Error(`connector output '${output}' is not mapped to a dataset in the manifest`);
  return dataset;
}

export function runConnectorSync(projectDir: string, name: string, opts: RetentionOpts = {}): Promise<SyncResult> {
  const key = `${projectDir}\0${name}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = doSync(projectDir, name, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function doSync(projectDir: string, name: string, opts: RetentionOpts): Promise<SyncResult> {
  loadEnv(projectDir);
  const startedAt = Date.now();
  const manifest = await readManifest(projectDir);
  const spec = lookupConnector(manifest, name);
  const def = await loadConnector(projectDir, spec);

  const config = def.config ? def.config.parse(spec.config ?? {}) : (spec.config ?? {});
  const { secrets } = readSecrets(def);
  const persisted = await readState(projectDir, name);

  const tokens = await resolveTokensForSync(projectDir, name, def, persisted);

  const datasets: SyncResult["datasets"] = {};
  const cursorState: Record<string, unknown> = { ...persisted.state };

  const datasetFor = (output: string): { dataset: string; target: WriteTarget } => {
    const dataset = resolveOutputDataset(spec, def, output);
    const datasetSpec = manifest.datasets[dataset];
    if (!datasetSpec?.source) throw new Error(`dataset '${dataset}' has no writable source`);
    return { dataset, target: { dataset, source: datasetSpec.source, table: datasetSpec.table } };
  };

  const ctx: ConnectorContext = {
    config: config as Record<string, unknown>,
    secrets,
    tokens,
    state: cursorState,
    async insert(output, rows) {
      const { dataset, target } = datasetFor(output);
      const schema = await datasetRowSchema(projectDir, dataset);
      const result = await insertValidatedRows(projectDir, target, schema, rows, opts);
      datasets[output] = { mode: "insert", rows: result.inserted, checkpoint_id: result.checkpoint_id || undefined };
      return result;
    },
    async replace(output, rows) {
      const { dataset, target } = datasetFor(output);
      const schema = await datasetRowSchema(projectDir, dataset);
      const result = await replaceValidatedRows(projectDir, target, schema, rows, opts);
      datasets[output] = { mode: "replace", rows: result.replaced, checkpoint_id: result.checkpoint_id };
      return result;
    },
    log(message) {
      console.log(`[connector ${name}] ${message}`);
    },
  };

  try {
    await def.sync(ctx);
  } catch (e) {
    const failed = await readState(projectDir, name);
    failed.lastError = (e as Error).message;
    await writeState(projectDir, name, failed);
    throw e;
  }

  const after = await readState(projectDir, name);
  after.state = cursorState;
  after.lastSync = new Date().toISOString();
  delete after.lastError;
  await writeState(projectDir, name, after);

  return { connector: name, datasets, durationMs: Date.now() - startedAt };
}

// --- Validation integration -----------------------------------------------------

export interface ConnectorValidationError {
  connector: string;
  field?: string;
  message: string;
}

/**
 * Best-effort connector checks for the compile/validate path: load each
 * connector module, parse its config against the connector's own schema, and
 * confirm every mapped output is declared. Missing secrets are NOT errors here —
 * they surface through status. A load/bundle failure is a named error.
 */
export async function checkConnectors(projectDir: string, manifest: Manifest): Promise<ConnectorValidationError[]> {
  const errors: ConnectorValidationError[] = [];
  for (const [name, spec] of Object.entries(manifest.connectors ?? {})) {
    let def: ConnectorDefinition;
    try {
      def = await loadConnector(projectDir, spec);
    } catch (e) {
      errors.push({ connector: name, message: (e as Error).message });
      continue;
    }

    if (def.config && spec.config !== undefined) {
      const parsed = def.config.safeParse(spec.config);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const path = issue.path.join(".");
          errors.push({ connector: name, field: `config.${path}`, message: path ? `config.${path}: ${issue.message}` : issue.message });
        }
      }
    }

    for (const output of Object.keys(spec.datasets)) {
      if (!(output in def.outputs)) {
        errors.push({ connector: name, field: `datasets.${output}`, message: `output '${output}' is not declared by the connector (declares: ${Object.keys(def.outputs).join(", ")})` });
      }
    }

    const schedule = effectiveSchedule(spec, def);
    if (schedule) {
      try {
        parseSchedule(schedule);
      } catch (e) {
        errors.push({ connector: name, field: "schedule", message: (e as Error).message });
      }
    }
  }
  return errors;
}

/** Removes a connector's persisted state entirely — used by tests/teardown. */
export async function clearConnectorState(projectDir: string, name: string): Promise<void> {
  await getAppStateStore(projectDir).delete(stateKey(name));
}
