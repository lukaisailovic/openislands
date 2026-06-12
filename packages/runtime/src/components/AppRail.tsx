import { Tooltip, cn } from "@cloudflare/kumo";
import { Link, useParams } from "@tanstack/react-router";
import { WarningCircle } from "@phosphor-icons/react";
import type { WorkspaceAppInfo } from "../server/dashboard.js";
import { pageIcon } from "./pageIcons.js";

function tileLabel(app: WorkspaceAppInfo): string {
  if (app.errorCount === 0) return app.title;
  return `${app.title} — ${app.errorCount} manifest error(s)`;
}

function AppTile({ app, active }: { app: WorkspaceAppInfo; active: boolean }) {
  const Icon = app.icon ? pageIcon(app.icon) : null;
  return (
    <div className="group relative flex w-full shrink-0 justify-center">
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-kumo-contrast transition-[height,opacity] duration-200 motion-reduce:transition-none",
          active ? "h-6 opacity-100" : "h-2 opacity-0 group-hover:opacity-60",
        )}
      />
      <Tooltip
        content={tileLabel(app)}
        side="right"
        delay={150}
        render={
          <Link
            to="/$appId"
            params={{ appId: app.id }}
            aria-label={tileLabel(app)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative grid size-10 cursor-pointer place-items-center transition-[border-radius,color] duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-kumo-focus focus-visible:outline-none",
              active
                ? "rounded-lg bg-kumo-tint text-kumo-strong"
                : "rounded-xl bg-kumo-tint text-kumo-subtle hover:rounded-lg hover:text-kumo-strong",
            )}
          >
            {Icon ? (
              <Icon size={20} />
            ) : (
              <span className="text-sm font-medium">
                {(app.title.trim()[0] ?? "?").toUpperCase()}
              </span>
            )}
            {app.errorCount > 0 ? (
              <WarningCircle
                aria-hidden
                weight="fill"
                size={15}
                className="absolute -top-1 -right-1 rounded-full bg-kumo-recessed text-kumo-danger"
              />
            ) : null}
          </Link>
        }
      />
    </div>
  );
}

/**
 * The Discord-style workspace switcher: one icon tile per served app.
 * Desktop only — on mobile the app picker lives inside the sidebar drawer.
 */
export function AppRail({ apps }: { apps: WorkspaceAppInfo[] }) {
  const { appId } = useParams({ strict: false });
  return (
    <nav
      aria-label="Apps"
      className="hidden w-14 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-kumo-hairline bg-kumo-recessed py-3 md:flex"
    >
      {apps.map((app) => (
        <AppTile key={app.id} app={app} active={app.id === appId} />
      ))}
    </nav>
  );
}
