import { createFileRoute } from "@tanstack/react-router";
import { bundleCustomComponent } from "../server/custom.js";
import { appDir } from "../server/workspace.js";

const JS_CONTENT_TYPE = { "content-type": "text/javascript; charset=utf-8" } as const;

async function handle(appId: string, file: string): Promise<Response> {
  if (!file.endsWith(".js")) return new Response("not found", { status: 404 });
  let dir: string;
  try {
    dir = appDir(appId);
  } catch {
    return new Response(`unknown app '${appId}'`, { status: 404 });
  }
  const type = file.slice(0, -3);
  const result = await bundleCustomComponent(dir, type);
  if (result.status !== 200 || !result.code) {
    return new Response(result.error ?? "not found", { status: result.status });
  }
  return new Response(result.code, { status: 200, headers: JS_CONTENT_TYPE });
}

export const Route = createFileRoute("/__custom/$appId/$file")({
  server: {
    handlers: {
      GET: ({ params }) => handle(params.appId, params.file),
    },
  },
});
