import { createFileRoute } from "@tanstack/react-router";
import { readDatasetSql } from "../server/source.js";
import { appDirFromParams } from "../server/workspace.js";

function handle(request: Request): Response {
  const url = new URL(request.url);
  const app = appDirFromParams(url.searchParams);
  if (!app.ok) {
    return new Response(JSON.stringify({ error: app.error }), {
      status: app.status,
      headers: { "content-type": "application/json" },
    });
  }
  const result = readDatasetSql(app.dir, url.searchParams.get("dataset") ?? "");
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/source")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
    },
  },
});
