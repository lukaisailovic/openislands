import { createFileRoute } from "@tanstack/react-router";
import { resolveActionForm, submitAction } from "../server/action.js";
import { appDirFromParams } from "../server/workspace.js";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** GET resolves an action's form schema (?app=&action=) for rendering a `form.entry` island. */
async function get(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const app = appDirFromParams(url.searchParams);
  if (!app.ok) return json({ error: app.error }, app.status);
  const result = await resolveActionForm(app.dir, url.searchParams.get("action") ?? "");
  return json(result.body, result.status);
}

/** POST inserts one row (?app=, JSON body { action, row }) — the same write path as the MCP run_action. */
async function post(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const app = appDirFromParams(url.searchParams);
  if (!app.ok) return json({ ok: false, error: app.error }, app.status);
  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const result = await submitAction(app.dir, payload);
  return json(result.body, result.status);
}

export const Route = createFileRoute("/api/action")({
  server: {
    handlers: {
      GET: ({ request }) => get(request),
      POST: ({ request }) => post(request),
    },
  },
});
