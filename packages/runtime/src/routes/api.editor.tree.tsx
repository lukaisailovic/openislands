import { createFileRoute } from "@tanstack/react-router";
import { treeResponse } from "../server/editorRoutes.js";

export const Route = createFileRoute("/api/editor/tree")({
  server: {
    handlers: {
      GET: ({ request }) => treeResponse(request),
    },
  },
});
