import { Outlet, createFileRoute, useLoaderData } from "@tanstack/react-router";
import { Text } from "@cloudflare/kumo";
import { AppIdContext } from "../../client/useAppId.js";
import { AppShell } from "../../components/AppShell.js";
import { getDashboard } from "../../server/dashboard.js";

export const Route = createFileRoute("/_shell/$appId")({
  loader: ({ params }) => getDashboard({ data: { appId: params.appId } }),
  component: AppLayout,
  notFoundComponent: AppNotFound,
});

function AppLayout() {
  const { appId } = Route.useParams();
  const { manifest, manifestErrors } = Route.useLoaderData();
  return (
    <AppIdContext.Provider value={appId}>
      <AppShell manifest={manifest} manifestErrors={manifestErrors}>
        <Outlet />
      </AppShell>
    </AppIdContext.Provider>
  );
}

function AppNotFound() {
  const apps = useLoaderData({ from: "/_shell" });
  return (
    <div className="px-6 py-10">
      <Text variant="heading3" as="h1">
        App not found
      </Text>
      <Text variant="secondary" size="sm" className="mt-2">
        Available apps: {apps.map((a) => a.id).join(", ") || "none"}
      </Text>
    </div>
  );
}
