import { createFileRoute } from "@tanstack/react-router";
import { historyResponse } from "../server/editorRoutes.js";

export const Route = createFileRoute("/api/editor/history")({
  server: {
    handlers: {
      GET: ({ request }) => historyResponse(request),
    },
  },
});
