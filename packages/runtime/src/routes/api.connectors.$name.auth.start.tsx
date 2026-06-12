import { createFileRoute } from "@tanstack/react-router";
import { authStartResponse } from "../server/connectorRoutes.js";

export const Route = createFileRoute("/api/connectors/$name/auth/start")({
  server: {
    handlers: {
      GET: ({ request, params }) => authStartResponse(request, params.name),
    },
  },
});
