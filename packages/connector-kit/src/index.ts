/**
 * @openislands/connector-kit — the contract a vendored connector implements.
 *
 * A connector lives in the user project at `connectors/<name>/index.ts` and
 * default-exports `defineConnector({ ... })`. The compiler loads it, hands its
 * `sync` a `ConnectorContext`, and the connector pulls from its provider and
 * writes rows back into the manifest's `source` datasets via `ctx.append` /
 * `ctx.replace`. Dependency-light by design — only zod.
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

/** Discriminated by `type`; type-specific config lives under `data` so new auth kinds stay additive. */
export type ConnectorAuth = { type: "oauth2"; data: OAuth2AuthData };

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
  append(output: O, rows: Record<string, unknown>[]): Promise<{ appended: number; checkpoint_id: string }>;
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
