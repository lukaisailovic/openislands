/**
 * @openislands/mcp/http — the MCP server over Streamable HTTP (MCP 2025-03-26).
 *
 * Wraps the same {@link createServer} factory used by the stdio entry in the SDK's
 * canonical stateful transport: one endpoint where POST carries JSON-RPC, GET opens
 * the SSE stream, and DELETE terminates a session, all keyed by the `mcp-session-id`
 * header. Routing and auth live in the caller (the CLI's serve layer); this module
 * owns only transport + session lifecycle for a single project.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";

export { createServer };

export interface McpHttpHandler {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

/** 4 MB — a JSON-RPC request body past this is never a legitimate MCP call. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function jsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

/** Buffer the request body and JSON.parse it; rejects oversized or non-JSON bodies. */
async function readJsonBody(req: IncomingMessage): Promise<{ body: unknown } | { error: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return { error: "request body too large" };
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return { error: "empty request body" };
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { error: "request body is not valid JSON" };
  }
}

/**
 * A Streamable-HTTP MCP handler for one project. Sessions are kept in-memory and
 * keyed by their `mcp-session-id`; each is backed by its own {@link createServer}
 * instance, so the read-many/write-one safety boundary is identical to stdio.
 */
export function createMcpHttpHandler(projectRoot: string): McpHttpHandler {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await readJsonBody(req);
    if ("error" in parsed) return jsonRpcError(res, 400, parsed.error);

    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId === "string") {
      const existing = transports.get(sessionId);
      if (!existing) return jsonRpcError(res, 400, "unknown session id");
      return existing.handleRequest(req, res, parsed.body);
    }

    if (!isInitializeRequest(parsed.body)) {
      return jsonRpcError(res, 400, "no session id and not an initialize request");
    }

    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      },
    });
    // The SDK Transport exposes `onclose` as a property setter, not an EventTarget, so
    // addEventListener doesn't apply. We don't use the `onsessionclosed` constructor option
    // because it fires only on an explicit DELETE — `onclose` also covers a client
    // disconnecting, which is what keeps the session map from leaking.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    const server = createServer(projectRoot);
    await server.connect(transport);
    return transport.handleRequest(req, res, parsed.body);
  }

  async function handleSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId !== "string") return jsonRpcError(res, 400, "missing session id");
    const transport = transports.get(sessionId);
    if (!transport) return jsonRpcError(res, 400, "unknown session id");
    return transport.handleRequest(req, res);
  }

  return {
    async handle(req, res) {
      const method = req.method ?? "GET";
      if (method === "POST") return handlePost(req, res);
      if (method === "GET" || method === "DELETE") return handleSession(req, res);
      jsonRpcError(res, 405, `method ${method} not allowed`);
    },
    async close() {
      await Promise.all([...transports.values()].map((t) => t.close()));
      transports.clear();
    },
  };
}
