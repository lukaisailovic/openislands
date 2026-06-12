import { createFileRoute } from "@tanstack/react-router";
import { syncConnectorResponse } from "../server/connectorRoutes.js";

export const Route = createFileRoute("/api/connectors/$name/sync")({
  server: {
    handlers: {
      POST: ({ request, params }) => syncConnectorResponse(request, params.name),
    },
  },
});
