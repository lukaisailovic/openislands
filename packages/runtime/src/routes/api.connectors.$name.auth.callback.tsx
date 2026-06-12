import { createFileRoute } from "@tanstack/react-router";
import { authCallbackResponse } from "../server/connectorRoutes.js";

export const Route = createFileRoute("/api/connectors/$name/auth/callback")({
  server: {
    handlers: {
      GET: ({ request, params }) => authCallbackResponse(request, params.name),
    },
  },
});
