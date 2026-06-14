import { createFileRoute } from "@tanstack/react-router";
import { restoreResponse } from "../server/editorRoutes.js";

export const Route = createFileRoute("/api/editor/restore")({
  server: {
    handlers: {
      POST: ({ request }) => restoreResponse(request),
    },
  },
});
