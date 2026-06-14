import { createFileRoute } from "@tanstack/react-router";
import { createResponse } from "../server/editorRoutes.js";

export const Route = createFileRoute("/api/editor/create")({
  server: {
    handlers: {
      POST: ({ request }) => createResponse(request),
    },
  },
});
