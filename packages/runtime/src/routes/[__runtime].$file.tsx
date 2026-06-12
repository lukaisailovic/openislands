import { createFileRoute } from "@tanstack/react-router";
import { runtimeShim } from "../server/custom.js";

const JS_CONTENT_TYPE = { "content-type": "text/javascript; charset=utf-8" } as const;

async function handle(file: string): Promise<Response> {
  const result = await runtimeShim(file);
  if (result.status !== 200 || !result.code) {
    return new Response(result.error ?? "not found", { status: result.status });
  }
  return new Response(result.code, { status: 200, headers: JS_CONTENT_TYPE });
}

export const Route = createFileRoute("/__runtime/$file")({
  server: {
    handlers: {
      GET: ({ params }) => handle(params.file),
    },
  },
});
