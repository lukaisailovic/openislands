import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { resetEngine } from "@openislands/compiler";
import { createMcpHttpHandler, type McpHttpHandler } from "../src/http.js";

const FIXTURE = new URL("fixtures/finance", import.meta.url).pathname;

interface Booted {
  url: string;
  handler: McpHttpHandler;
  server: Server;
}

const booted: Booted[] = [];

afterEach(async () => {
  for (const { handler, server } of booted.splice(0)) {
    await handler.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
  resetEngine(FIXTURE);
});

async function boot(): Promise<string> {
  const handler = createMcpHttpHandler(FIXTURE);
  const server = createHttpServer((req, res) => void handler.handle(req, res));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  booted.push({ url, handler, server });
  return url;
}

const INIT_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
}

describe("createMcpHttpHandler", () => {
  it("issues an mcp-session-id on initialize and accepts a follow-up request with it", async () => {
    const url = await boot();

    const init = await post(url, INIT_BODY);
    expect(init.status).toBe(200);
    const sessionId = init.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    await init.text();

    const followUp = await post(
      url,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { "mcp-session-id": sessionId! },
    );
    expect(followUp.status).toBe(200);
    await followUp.text();
  });

  it("rejects a POST with no session id that is not an initialize request", async () => {
    const url = await boot();
    const res = await post(url, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(400);
    await res.text();
  });

  it("rejects a POST carrying an unknown session id", async () => {
    const url = await boot();
    const res = await post(
      url,
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "mcp-session-id": "nope" },
    );
    expect(res.status).toBe(400);
    await res.text();
  });

  it("rejects a GET without a session id", async () => {
    const url = await boot();
    const res = await fetch(url, { headers: { accept: "text/event-stream" } });
    expect(res.status).toBe(400);
    await res.text();
  });

  it("rejects a non-JSON POST body", async () => {
    const url = await boot();
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    await res.text();
  });
});
