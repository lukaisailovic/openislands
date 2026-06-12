import { createFileRoute, redirect } from "@tanstack/react-router";
import { getWorkspace } from "../server/dashboard.js";

export const Route = createFileRoute("/")({
  loader: async () => {
    const apps = await getWorkspace();
    const first = apps[0];
    if (!first) return;
    throw redirect({ to: "/$appId", params: { appId: first.id } });
  },
  component: () => null,
});
