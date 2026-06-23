import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedHostsFromEnv, apiRequestForbiddenReason, assertMcpHostSafe, handleServeRequest, newMcpHandlerHolder, warnRuntimeHostExposed, type McpConfig } from "../src/serve.js";

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

const noHandler = () => newMcpHandlerHolder();

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
    const owned = handleServeRequest(undefined, noHandler(), mockReq("GET", "/healthz"), res);
    expect(owned).toBe(true);
    expect(status()).toBe(200);
    expect(JSON.parse(body())).toEqual({ status: "ok" });
  });

  it("falls through (returns false) for a non-MCP path when MCP is disabled", () => {
    const { res } = mockRes();
    expect(handleServeRequest(undefined, noHandler(), mockReq("GET", "/dashboard"), res)).toBe(false);
  });

  it("serves exactly /mcp but 404s any /mcp/... subpath (apps are a tool param, not a URL)", () => {
    const mcp: McpConfig = { token: null, projectRoot: "/tmp/workspace" };
    const { res, status, body } = mockRes();
    const owned = handleServeRequest(mcp, noHandler(), mockReq("POST", "/mcp/finance", {}, { jsonrpc: "2.0" }), res);
    expect(owned).toBe(true);
    expect(status()).toBe(404);
    expect(JSON.parse(body()).error).toMatch(/POST to \/mcp/);
  });

  it("401s an MCP request with a missing bearer token when a token is configured", () => {
    const mcp: McpConfig = { token: "secret", projectRoot: "/tmp/workspace" };
    const { res, status } = mockRes();
    handleServeRequest(mcp, noHandler(), mockReq("POST", "/mcp", {}, { jsonrpc: "2.0" }), res);
    expect(status()).toBe(401);
  });

  it("401s an MCP request with a wrong bearer token", () => {
    const mcp: McpConfig = { token: "secret", projectRoot: "/tmp/workspace" };
    const { res, status } = mockRes();
    handleServeRequest(mcp, noHandler(), mockReq("POST", "/mcp", { authorization: "Bearer wrong" }, { jsonrpc: "2.0" }), res);
    expect(status()).toBe(401);
  });

  it("passes auth with the correct bearer token and delegates to the lazily-created MCP handler", async () => {
    const mcp: McpConfig = { token: "secret", projectRoot: "/tmp/workspace" };
    const holder = newMcpHandlerHolder();
    const { res, status } = mockRes();
    // A correct token gets past the 401 gate and into the real handler, which — given a
    // bodyless, sessionless, non-initialize POST — answers 400. The point is it is NOT 401,
    // and that the single workspace handler was created on first use.
    const owned = handleServeRequest(mcp, holder, mockReq("POST", "/mcp", { authorization: "Bearer secret" }), res);
    expect(owned).toBe(true);
    expect(holder.handler).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(status()).not.toBe(401);
  });
});

const reqOf = (method: string, headers: Record<string, string>) => ({ method, headers }) as unknown as IncomingMessage;

describe("apiRequestForbiddenReason", () => {
  const none = new Set<string>();

  it("allows a GET from a loopback host", () => {
    expect(apiRequestForbiddenReason(reqOf("GET", { host: "localhost:4321" }), "127.0.0.1", none)).toBeNull();
    expect(apiRequestForbiddenReason(reqOf("GET", { host: "127.0.0.1:4321" }), "127.0.0.1", none)).toBeNull();
  });

  it("blocks a request whose Host is foreign on a loopback bind (DNS rebinding)", () => {
    const r = apiRequestForbiddenReason(reqOf("GET", { host: "attacker.com:4321" }), "127.0.0.1", none);
    expect(r).toMatch(/rebinding/i);
  });

  it("permits a foreign Host via the allowlist", () => {
    const allowed = allowedHostsFromEnv("myapp.local");
    expect(apiRequestForbiddenReason(reqOf("GET", { host: "myapp.local:4321" }), "127.0.0.1", allowed)).toBeNull();
  });

  it("blocks a cross-site POST (Sec-Fetch-Site)", () => {
    const r = apiRequestForbiddenReason(
      reqOf("POST", { host: "localhost:4321", "sec-fetch-site": "cross-site", "content-type": "text/plain" }),
      "127.0.0.1",
      none,
    );
    expect(r).toMatch(/cross-site/i);
  });

  it("allows a same-origin POST", () => {
    expect(
      apiRequestForbiddenReason(reqOf("POST", { host: "localhost:4321", "sec-fetch-site": "same-origin" }), "127.0.0.1", none),
    ).toBeNull();
    expect(
      apiRequestForbiddenReason(reqOf("POST", { host: "localhost:4321", "sec-fetch-site": "none" }), "127.0.0.1", none),
    ).toBeNull();
  });

  it("allows a POST from a non-browser caller (no Origin / Sec-Fetch headers)", () => {
    expect(apiRequestForbiddenReason(reqOf("POST", { host: "127.0.0.1:4321" }), "127.0.0.1", none)).toBeNull();
  });

  it("blocks a POST whose Origin host:port mismatches, allows a match", () => {
    expect(
      apiRequestForbiddenReason(reqOf("POST", { host: "localhost:4321", origin: "http://evil.com" }), "127.0.0.1", none),
    ).toMatch(/cross-origin/i);
    expect(
      apiRequestForbiddenReason(reqOf("POST", { host: "localhost:4321", origin: "http://localhost:4321" }), "127.0.0.1", none),
    ).toBeNull();
  });

  it("skips the host check on a non-loopback bind but still blocks cross-site writes", () => {
    expect(apiRequestForbiddenReason(reqOf("GET", { host: "192.168.1.9:4321" }), "0.0.0.0", none)).toBeNull();
    expect(
      apiRequestForbiddenReason(reqOf("POST", { host: "192.168.1.9:4321", "sec-fetch-site": "cross-site" }), "0.0.0.0", none),
    ).toMatch(/cross-site/i);
  });
});

describe("allowedHostsFromEnv", () => {
  it("parses a comma list, trims, lowercases, drops blanks", () => {
    expect([...allowedHostsFromEnv(" Foo.local, BAR:8080 ,, ")]).toEqual(["foo.local", "bar:8080"]);
    expect(allowedHostsFromEnv(undefined).size).toBe(0);
  });
});

describe("warnRuntimeHostExposed", () => {
  it("warns on a non-loopback bind, stays silent on loopback", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    warnRuntimeHostExposed("127.0.0.1");
    warnRuntimeHostExposed("localhost");
    expect(err).not.toHaveBeenCalled();
    warnRuntimeHostExposed("0.0.0.0");
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0]![0]).toMatch(/non-loopback/i);
  });
});
