import { createFileRoute } from "@tanstack/react-router";
import { deleteResponse } from "../server/editorRoutes.js";

export const Route = createFileRoute("/api/editor/delete")({
  server: {
    handlers: {
      POST: ({ request }) => deleteResponse(request),
    },
  },
});
