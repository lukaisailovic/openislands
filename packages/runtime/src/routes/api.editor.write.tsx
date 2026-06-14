import { createFileRoute } from "@tanstack/react-router";
import { writeResponse } from "../server/editorRoutes.js";

export const Route = createFileRoute("/api/editor/write")({
  server: {
    handlers: {
      POST: ({ request }) => writeResponse(request),
    },
  },
});
