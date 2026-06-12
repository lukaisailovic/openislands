import { createFileRoute } from "@tanstack/react-router";
import { readProjectFile } from "../server/file.js";
import { appDirFromParams } from "../server/workspace.js";

function handle(request: Request): Response {
  const url = new URL(request.url);
  const app = appDirFromParams(url.searchParams);
  if (!app.ok) return new Response(app.error, { status: app.status });
  const result = readProjectFile(app.dir, url.searchParams.get("path") ?? "");
  return new Response(result.body, {
    status: result.status,
    headers: { "content-type": result.contentType },
  });
}

export const Route = createFileRoute("/api/file")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
    },
  },
});
