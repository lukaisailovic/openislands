import { createFileRoute } from "@tanstack/react-router";
import { ARROW_CONTENT_TYPE, parseQueryParams, runQuery } from "../server/query.js";
import { appDirFromParams } from "../server/workspace.js";

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params =
    request.method === "POST" ? new URLSearchParams(await request.text()) : url.searchParams;
  const app = appDirFromParams(params);
  if (!app.ok) {
    return new Response(JSON.stringify({ error: app.error }), {
      status: app.status,
      headers: { "content-type": "application/json" },
    });
  }
  const result = await runQuery(app.dir, parseQueryParams(params, request.headers.get("accept")));

  if (result.status === 200 && result.format === "arrow" && result.arrow) {
    return new Response(result.arrow, {
      status: 200,
      headers: { "content-type": ARROW_CONTENT_TYPE },
    });
  }

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/query")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
