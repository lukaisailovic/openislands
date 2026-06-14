import { createFileRoute } from "@tanstack/react-router";
import { moveResponse } from "../server/editorRoutes.js";

export const Route = createFileRoute("/api/editor/move")({
  server: {
    handlers: {
      POST: ({ request }) => moveResponse(request),
    },
  },
});
