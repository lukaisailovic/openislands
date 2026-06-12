import { createFileRoute } from "@tanstack/react-router";
import { SSE_HEADERS, createEventStream } from "../server/events.js";
import { appDirFromParams } from "../server/workspace.js";

function handle(request: Request): Response {
  const app = appDirFromParams(new URL(request.url).searchParams);
  if (!app.ok) return new Response(app.error, { status: app.status });
  return new Response(createEventStream(app.appId), { headers: SSE_HEADERS });
}

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
    },
  },
});
