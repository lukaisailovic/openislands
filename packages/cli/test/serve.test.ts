import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertMcpHostSafe, handleServeRequest, type McpConfig, type McpHttpHandler } from "../src/serve.js";

afterEach(() => vi.restoreAllMocks());

function mockReq(method: string, url: string, headers: Record<string, string> = {}, body?: unknown): IncomingMessage {
  const req = {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    },
  };
  return req as unknown as IncomingMessage;
}

function mockRes(): { res: ServerResponse; status: () => number; body: () => string; headers: Record<string, string> } {
  let statusCode = 200;
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
    },
  };
  return { res: res as unknown as ServerResponse, status: () => statusCode, body: () => body, headers };
}

const noHandlers = () => new Map<string, McpHttpHandler>();

describe("assertMcpHostSafe", () => {
  it("does nothing when MCP is disabled, even on a public host without a token", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    assertMcpHostSafe("0.0.0.0", false, null);
    expect(exit).not.toHaveBeenCalled();
  });

  it("allows a loopback host with no token", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    for (const host of ["127.0.0.1", "::1", "localhost"]) assertMcpHostSafe(host, true, null);
    expect(exit).not.toHaveBeenCalled();
  });

  it("allows a public host when a token is set", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    assertMcpHostSafe("0.0.0.0", true, "secret");
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits non-zero with a write-surface error on a public host without a token", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    assertMcpHostSafe("0.0.0.0", true, null);
    expect(exit).toHaveBeenCalledWith(1);
    expect(err.mock.calls.flat().join(" ")).toMatch(/write surface|apply_edit|run_action/);
  });
});

describe("handleServeRequest", () => {
  it("answers /healthz with 200 ok even when MCP is disabled", () => {
    const { res, status, body } = mockRes();
    const owned = handleServeRequest(undefined, noHandlers(), mockReq("GET", "/healthz"), res);
    expect(owned).toBe(true);
    expect(status()).toBe(200);
    expect(JSON.parse(body())).toEqual({ status: "ok" });
  });

  it("falls through (returns false) for a non-MCP path when MCP is disabled", () => {
    const { res } = mockRes();
    expect(handleServeRequest(undefined, noHandlers(), mockReq("GET", "/dashboard"), res)).toBe(false);
  });

  it("404s a multi-app bare /mcp and lists the valid app ids", () => {
    const mcp: McpConfig = {
      token: null,
      mounts: [
        { basePath: "/mcp/finance", projectDir: "/tmp/finance" },
        { basePath: "/mcp/health", projectDir: "/tmp/health" },
      ],
    };
    const { res, status, body } = mockRes();
    const owned = handleServeRequest(mcp, noHandlers(), mockReq("POST", "/mcp", {}, { jsonrpc: "2.0" }), res);
    expect(owned).toBe(true);
    expect(status()).toBe(404);
    expect(JSON.parse(body()).apps).toEqual(["finance", "health"]);
  });

  it("404s an unknown appId in multi-app mode", () => {
    const mcp: McpConfig = { token: null, mounts: [{ basePath: "/mcp/finance", projectDir: "/tmp/finance" }] };
    const { res, status } = mockRes();
    handleServeRequest(mcp, noHandlers(), mockReq("POST", "/mcp/ghost", {}, { jsonrpc: "2.0" }), res);
    expect(status()).toBe(404);
  });

  it("401s an MCP request with a missing bearer token when a token is configured", () => {
    const mcp: McpConfig = { token: "secret", mounts: [{ basePath: "/mcp", projectDir: "/tmp/app" }] };
    const { res, status } = mockRes();
    handleServeRequest(mcp, noHandlers(), mockReq("POST", "/mcp", {}, { jsonrpc: "2.0" }), res);
    expect(status()).toBe(401);
  });

  it("401s an MCP request with a wrong bearer token", () => {
    const mcp: McpConfig = { token: "secret", mounts: [{ basePath: "/mcp", projectDir: "/tmp/app" }] };
    const { res, status } = mockRes();
    handleServeRequest(mcp, noHandlers(), mockReq("POST", "/mcp", { authorization: "Bearer wrong" }, { jsonrpc: "2.0" }), res);
    expect(status()).toBe(401);
  });

  it("passes auth with the correct bearer token and delegates to the MCP handler", async () => {
    const mcp: McpConfig = { token: "secret", mounts: [{ basePath: "/mcp", projectDir: "/tmp/app" }] };
    const handlers = noHandlers();
    const { res, status } = mockRes();
    // A correct token gets past the 401 gate and into the real handler, which — given a
    // bodyless, sessionless, non-initialize POST — answers 400. The point is it is NOT 401.
    const owned = handleServeRequest(mcp, handlers, mockReq("POST", "/mcp", { authorization: "Bearer secret" }), res);
    expect(owned).toBe(true);
    expect(handlers.has("/mcp")).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(status()).not.toBe(401);
  });
});
