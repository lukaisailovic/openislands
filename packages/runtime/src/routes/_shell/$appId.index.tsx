import { createFileRoute, redirect } from "@tanstack/react-router";
import { getDashboard } from "../../server/dashboard.js";

export const Route = createFileRoute("/_shell/$appId/")({
  loader: async ({ params }) => {
    const { manifest } = await getDashboard({ data: { appId: params.appId } });
    const first = manifest.pages[0];
    if (!first) return;
    throw redirect({
      to: "/$appId/$pageId",
      params: { appId: params.appId, pageId: first.id },
    });
  },
  component: () => null,
});
