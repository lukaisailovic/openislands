/**
 * @openislands/connector-kit — the contract a vendored connector implements.
 *
 * A connector lives in the user project at `connectors/<name>/index.ts` and
 * default-exports `defineConnector({ ... })`. The compiler loads it, hands its
 * `sync` a `ConnectorContext`, and the connector pulls from its provider and
 * writes rows back into the manifest's `source` datasets via `ctx.insert` /
 * `ctx.replace` — which land the same way whether the dataset is backed by a
 * file or a SQLite table. Dependency-light by design — only zod.
 */
import type { ZodType } from "zod";

/** OAuth2 authorization-code config. Client id/secret are read from .env, never inlined. */
export interface OAuth2AuthData {
  authorizeUrl: string;
  tokenUrl: string;
  scopes?: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
}

/**
 * A static bearer token — a long-lived API token or JWT the user pastes into
 * `.env`. No interactive sign-in: the runtime reads the token and hands it to
 * `sync` as `ctx.tokens.accessToken`, exactly like an OAuth access token, so a
 * connector's request code (`Authorization: Bearer …`) is identical either way.
 */
export interface BearerAuthData {
  /** .env key holding the bearer token; surfaced as a missing secret when unset. */
  tokenEnv: string;
}

/** Discriminated by `type`; type-specific config lives under `data` so new auth kinds stay additive. */
export type ConnectorAuth =
  | { type: "oauth2"; data: OAuth2AuthData }
  | { type: "bearer"; data: BearerAuthData };

export interface ConnectorTokens {
  accessToken: string;
  refreshToken?: string;
  /** ISO timestamp; used to refresh before expiry. */
  expiresAt?: string;
}

/** What a connector's `sync` is handed: parsed config, secrets, tokens, cursor state, and the write path. */
export interface ConnectorContext<C = Record<string, unknown>, O extends string = string, S extends string = string> {
  config: C;
  secrets: Record<S, string>;
  tokens?: ConnectorTokens;
  /** Mutable cursor object, persisted after a successful sync. */
  state: Record<string, unknown>;
  /** Add rows to an output's dataset (immutable records; advance a cursor in `state`). */
  insert(output: O, rows: Record<string, unknown>[]): Promise<{ inserted: number; checkpoint_id: string }>;
  /** Overwrite an output's dataset (records that get revised — rewrite the whole set each sync). */
  replace(output: O, rows: Record<string, unknown>[]): Promise<{ replaced: number; checkpoint_id?: string }>;
  log(message: string): void;
}

export interface ConnectorDefinition<C = Record<string, unknown>, O extends string = string, S extends string = string> {
  description?: string;
  config?: ZodType<C>;
  /** Required .env keys; surfaced as missing in status, never a hard validation error. */
  secrets?: readonly S[];
  /** Omit for keyless/API-key connectors. */
  auth?: ConnectorAuth;
  /** Default sync interval (e.g. "6h"), overridable by the manifest. Omit for manual-only syncs (dashboard, CLI, MCP). */
  schedule?: string;
  /** Declared outputs; the manifest's `datasets` keys must be a subset of these. */
  outputs: Record<O, { description?: string }>;
  sync(ctx: ConnectorContext<C, O, S>): Promise<void>;
}

export function defineConnector<C = Record<string, unknown>, const O extends string = string, const S extends string = string>(
  def: ConnectorDefinition<C, O, S>,
): ConnectorDefinition<C, O, S> {
  return def;
}
