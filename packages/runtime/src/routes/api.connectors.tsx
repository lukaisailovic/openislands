import { createFileRoute } from "@tanstack/react-router";
import { listConnectorsResponse } from "../server/connectorRoutes.js";

export const Route = createFileRoute("/api/connectors")({
  server: {
    handlers: {
      GET: ({ request }) => listConnectorsResponse(request),
    },
  },
});
