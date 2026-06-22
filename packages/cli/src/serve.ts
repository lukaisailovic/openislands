/**
 * serve-layer HTTP routing for `openislands serve`: the `/healthz` probe and the optional
 * MCP-over-HTTP mounts that sit in front of the TanStack Start runtime. Kept out of index.ts
 * (which runs the CLI on import) so this logic stays unit-testable in isolation.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createMcpHttpHandler, type McpHttpHandler } from "@openislands/mcp/http";

export type { McpHttpHandler };

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0:0:0:0:0:0:0:1"]);

export interface McpConfig {
  token: string | null;
  mounts: Array<{ basePath: string; projectDir: string }>;
}

/** An env flag is on for `1` / `true` (case-insensitive); anything else (incl. unset) is off. */
export function envFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/**
 * MCP over a non-loopback host is a remote write surface (apply_edit/run_action). A token is
 * mandatory there; loopback is local trust (parity with stdio). Fail loud and exit rather than
 * silently exposing the surface.
 */
export function assertMcpHostSafe(host: string, mcpEnabled: boolean, token: string | null): void {
  if (!mcpEnabled) return;
  if (LOOPBACK_HOSTS.has(host)) return;
  if (token) return;
  console.error(
    red(
      `\n✗ MCP on a non-loopback host (${host}) exposes a write surface (apply_edit / run_action). ` +
        `Set --mcp-token or OPENISLANDS_MCP_TOKEN, or bind to loopback (127.0.0.1).`,
    ),
  );
  process.exit(1);
}

/** Constant-time bearer-token check — `undefined` header or any mismatch fails. */
function bearerTokenMatches(header: string | undefined, token: string): boolean {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const presented = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** The mount whose basePath matches this pathname (exact `/mcp` or `/mcp/<appId>`), longest first. */
function matchMount(mounts: McpConfig["mounts"], pathname: string): McpConfig["mounts"][number] | undefined {
  return mounts
    .toSorted((a, b) => b.basePath.length - a.basePath.length)
    .find((m) => pathname === m.basePath || pathname.startsWith(`${m.basePath}/`));
}

/**
 * Route + auth an MCP request, lazily creating (and caching) the handler for its mount. Returns
 * true once it has owned the response, false to fall through to the runtime. A multi-app request
 * to a bare/unknown `/mcp/...` path is owned with a 404 that lists the valid app ids.
 */
function handleMcpRequest(
  mcp: McpConfig,
  handlers: Map<string, McpHttpHandler>,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (pathname !== "/mcp" && !pathname.startsWith("/mcp/")) return false;

  const mount = matchMount(mcp.mounts, pathname);
  if (!mount) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "no MCP app at this path — specify one of `apps`", apps: mcp.mounts.map((m) => m.basePath.slice("/mcp/".length)) }));
    return true;
  }

  if (mcp.token && !bearerTokenMatches(req.headers.authorization, mcp.token)) {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "missing or invalid bearer token" }));
    return true;
  }

  let handler = handlers.get(mount.basePath);
  if (!handler) {
    handler = createMcpHttpHandler(mount.projectDir);
    handlers.set(mount.basePath, handler);
  }
  void handler.handle(req, res);
  return true;
}

/**
 * The serve-layer routes that sit in front of the runtime: `/healthz` (always on, so a container
 * healthcheck never depends on a runtime route) and the MCP mounts (when configured). Returns true
 * once it has owned the response; false falls through to static assets + the SSR fetch handler.
 * One code path for both the live server and its tests.
 */
export function handleServeRequest(
  mcp: McpConfig | undefined,
  handlers: Map<string, McpHttpHandler>,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const pathname = (req.url ?? "/").split("?")[0]!;
  if (pathname === "/healthz") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ok" }));
    return true;
  }
  if (mcp) return handleMcpRequest(mcp, handlers, pathname, req, res);
  return false;
}
