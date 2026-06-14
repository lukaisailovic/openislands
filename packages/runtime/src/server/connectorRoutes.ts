/**
 * Shared request handlers behind the `/api/connectors/*` routes. The route files
 * stay thin wiring; the JSON envelope and error→500 handling live here once.
 *
 * Every handler is app-scoped via `?app=` except the OAuth callback: providers
 * redirect back to a pre-registered URI that can't carry the app, so the
 * callback finds the app by matching the flow's `state` against each workspace
 * app's pending OAuth state.
 */
import {
  completeConnectorOAuth,
  getConnectorAuthorizeUrl,
  hasPendingOAuthState,
  listConnectorStatuses,
  runConnectorSync,
} from "@openislands/compiler";
import { type WorkspaceApp, appDirFromParams, listApps } from "./workspace.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function callbackRedirectUri(origin: string, name: string): string {
  return `${origin}/api/connectors/${encodeURIComponent(name)}/auth/callback`;
}

/** Resolve `?app=` to the app's project dir, or an error Response. */
function resolveApp(request: Request): { dir: string } | { response: Response } {
  const app = appDirFromParams(new URL(request.url).searchParams);
  if (!app.ok) return { response: json({ error: app.error }, app.status) };
  return { dir: app.dir };
}

export async function listConnectorsResponse(request: Request): Promise<Response> {
  const app = resolveApp(request);
  if ("response" in app) return app.response;
  return json(await listConnectorStatuses(app.dir));
}

export async function syncConnectorResponse(request: Request, name: string): Promise<Response> {
  const app = resolveApp(request);
  if ("response" in app) return app.response;
  try {
    return json(await runConnectorSync(app.dir, name));
  } catch (err) {
    return json({ error: errorMessage(err) }, 500);
  }
}

export async function authStartResponse(request: Request, name: string): Promise<Response> {
  const app = resolveApp(request);
  if ("response" in app) return app.response;
  const redirectUri = callbackRedirectUri(new URL(request.url).origin, name);
  try {
    const authorizeUrl = await getConnectorAuthorizeUrl(app.dir, name, redirectUri);
    return new Response(null, { status: 302, headers: { location: authorizeUrl } });
  } catch (err) {
    return json({ error: errorMessage(err) }, 500);
  }
}

export async function authCallbackResponse(request: Request, name: string): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return new Response("missing code or state", { status: 400 });

  let app: WorkspaceApp | undefined;
  for (const candidate of listApps()) {
    if (await hasPendingOAuthState(candidate.dir, name, state)) {
      app = candidate;
      break;
    }
  }
  if (!app) return new Response("no pending connection matches this callback", { status: 400 });

  try {
    await completeConnectorOAuth(app.dir, name, {
      code,
      state,
      redirectUri: callbackRedirectUri(url.origin, name),
    });
  } catch (err) {
    return new Response(`connection failed: ${errorMessage(err)}`, { status: 400 });
  }
  return new Response(null, {
    status: 302,
    headers: { location: `/${app.id}/?connected=${encodeURIComponent(name)}` },
  });
}
