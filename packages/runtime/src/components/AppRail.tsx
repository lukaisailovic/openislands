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
    <div className="group relative flex shrink-0 justify-center md:w-full">
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 left-0 hidden w-1 -translate-y-1/2 rounded-r-full bg-kumo-contrast transition-[height,opacity] duration-200 motion-reduce:transition-none md:block",
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
                ? "rounded-lg bg-kumo-tint text-kumo-strong max-md:ring-1 max-md:ring-kumo-line"
                : "rounded-xl bg-kumo-tint text-kumo-subtle hover:rounded-lg hover:text-kumo-strong",
            )}
          >
            {Icon ? (
              <Icon size={20} />
            ) : (
              <span className="text-sm font-medium">{(app.title.trim()[0] ?? "?").toUpperCase()}</span>
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
 * A vertical left rail from md up; a horizontal scrollable strip on mobile.
 */
export function AppRail({ apps }: { apps: WorkspaceAppInfo[] }) {
  const { appId } = useParams({ strict: false });
  return (
    <nav
      aria-label="Apps"
      className="flex h-14 w-full shrink-0 items-center gap-2 overflow-x-auto border-b border-kumo-hairline bg-kumo-recessed px-3 md:h-auto md:w-14 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:px-0 md:py-3"
    >
      {apps.map((app) => (
        <AppTile key={app.id} app={app} active={app.id === appId} />
      ))}
    </nav>
  );
}
