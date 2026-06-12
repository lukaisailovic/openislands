import { Outlet, createFileRoute } from "@tanstack/react-router";
import { getWorkspace } from "../server/dashboard.js";

export const Route = createFileRoute("/_shell")({
  loader: () => getWorkspace(),
  component: Outlet,
});
