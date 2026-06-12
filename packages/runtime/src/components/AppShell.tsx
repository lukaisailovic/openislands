import { Banner, Sidebar, Text, useSidebar } from "@cloudflare/kumo";
import { useParams } from "@tanstack/react-router";
import { Island, WarningCircle } from "@phosphor-icons/react";
import type { Manifest } from "@openislands/schema";
import type { ReactNode } from "react";
import type { IslandValidationError } from "../types.js";
import type { WorkspaceAppInfo } from "../server/dashboard.js";
import { useAppId } from "../client/useAppId.js";
import { AppRail } from "./AppRail.js";
import { ConnectionsButton } from "./ConnectionsDialog.js";
import { pageIcon } from "./pageIcons.js";

function ManifestErrorBanner({ errors }: { errors: IslandValidationError[] }) {
  if (errors.length === 0) return null;
  return (
    <Banner
      data-testid="manifest-errors"
      className="mb-5"
      variant="error"
      icon={<WarningCircle weight="fill" />}
      title="Manifest has errors — ask your agent to fix it"
      description={
        <ul className="mt-1 list-disc pl-5">
          {errors.map((e, i) => (
            <li key={i}>
              [{e.page}#{e.index} {e.type}] {e.message}
            </li>
          ))}
        </ul>
      }
    />
  );
}

function useCloseDrawer() {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}

function PageNav({ manifest }: { manifest: Manifest }) {
  const appId = useAppId();
  const { pageId } = useParams({ strict: false });
  const closeDrawer = useCloseDrawer();
  return (
    <Sidebar.Menu>
      {manifest.pages.map((page) => {
        const Icon = pageIcon(page.icon);
        return (
          <Sidebar.MenuItem key={page.id}>
            <Sidebar.MenuButton
              href={`/${appId}/${page.id}`}
              icon={Icon}
              active={page.id === pageId}
              tooltip={page.title ?? page.id}
              onClick={closeDrawer}
            >
              {page.title ?? page.id}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        );
      })}
    </Sidebar.Menu>
  );
}

function AppNav({ apps }: { apps: WorkspaceAppInfo[] }) {
  const appId = useAppId();
  const closeDrawer = useCloseDrawer();
  return (
    <Sidebar.Menu>
      {apps.map((app) => (
        <Sidebar.MenuItem key={app.id}>
          <Sidebar.MenuButton
            href={`/${app.id}`}
            icon={app.icon ? pageIcon(app.icon) : undefined}
            active={app.id === appId}
            onClick={closeDrawer}
          >
            {app.title}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      ))}
    </Sidebar.Menu>
  );
}

function TopBar({ showTrigger, hasConnectors }: { showTrigger: boolean; hasConnectors: boolean }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-kumo-line px-3">
      {showTrigger ? <Sidebar.Trigger className="md:hidden" /> : null}
      <div className="grid size-7 place-items-center rounded-md bg-kumo-contrast text-kumo-inverse">
        <Island size={16} weight="fill" />
      </div>
      <Text variant="heading3" as="span" className="tracking-tight">
        OpenIslands
      </Text>
      {hasConnectors ? (
        <div className="ml-auto">
          <ConnectionsButton />
        </div>
      ) : null}
    </header>
  );
}

interface Props {
  manifest: Manifest;
  manifestErrors: IslandValidationError[];
  apps: WorkspaceAppInfo[];
  children: ReactNode;
}

/**
 * The Kumo-docs-style chrome: a full-width top bar with the OpenIslands brand,
 * then the app picker rail (desktop), the page sidebar, and the content.
 * On mobile the rail disappears — the app picker lives inside the sidebar
 * drawer instead, so a single-page app in a workspace still gets a drawer.
 */
export function AppShell({ manifest, manifestErrors, apps, children }: Props) {
  const multiApp = apps.length > 1;
  const multiPage = manifest.pages.length > 1;
  const hasSidebar = multiPage || multiApp;
  const hasConnectors = Object.keys(manifest.connectors ?? {}).length > 0;

  return (
    <Sidebar.Provider defaultOpen collapsible="icon" contained className="h-svh flex-col">
      <TopBar showTrigger={hasSidebar} hasConnectors={hasConnectors} />
      <div className="flex min-h-0 flex-1">
        {multiApp ? <AppRail apps={apps} /> : null}
        {hasSidebar ? (
          <Sidebar className={multiPage ? undefined : "md:hidden"}>
            <Sidebar.Header>
              <Text variant="heading3" as="span" className="truncate tracking-tight">
                {manifest.title}
              </Text>
            </Sidebar.Header>
            <Sidebar.Content>
              {multiPage ? (
                <Sidebar.Group>
                  <PageNav manifest={manifest} />
                </Sidebar.Group>
              ) : null}
              {multiApp ? (
                <Sidebar.Group className="md:hidden">
                  <Sidebar.GroupLabel>Apps</Sidebar.GroupLabel>
                  <AppNav apps={apps} />
                </Sidebar.Group>
              ) : null}
            </Sidebar.Content>
            <Sidebar.Footer>
              <Sidebar.Trigger />
            </Sidebar.Footer>
            <Sidebar.Rail />
          </Sidebar>
        ) : null}
        <main className="min-w-0 flex-1 overflow-y-auto px-6 pt-6 pb-20">
          <div className={multiPage ? undefined : "mx-auto max-w-[1100px]"}>
            <ManifestErrorBanner errors={manifestErrors} />
            {children}
          </div>
        </main>
      </div>
    </Sidebar.Provider>
  );
}
