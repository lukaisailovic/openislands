import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppRail } from "../components/AppRail.js";
import { getWorkspace } from "../server/dashboard.js";

export const Route = createFileRoute("/_shell")({
  loader: () => getWorkspace(),
  component: ShellLayout,
});

function ShellLayout() {
  const apps = Route.useLoaderData();
  return (
    <div className="flex h-svh flex-col md:flex-row">
      {apps.length > 1 ? <AppRail apps={apps} /> : null}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
