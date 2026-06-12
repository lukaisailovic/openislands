import { Banner, Sidebar, Text, useSidebar } from "@cloudflare/kumo";
import { useParams } from "@tanstack/react-router";
import { WarningCircle } from "@phosphor-icons/react";
import type { Manifest } from "@openislands/schema";
import type { ReactNode } from "react";
import type { IslandValidationError } from "../types.js";
import { useAppId } from "../client/useAppId.js";
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

function PageNav({ manifest }: { manifest: Manifest }) {
  const appId = useAppId();
  const { pageId } = useParams({ strict: false });
  const { isMobile, setOpenMobile } = useSidebar();
  const closeDrawer = () => {
    if (isMobile) setOpenMobile(false);
  };
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

interface Props {
  manifest: Manifest;
  manifestErrors: IslandValidationError[];
  children: ReactNode;
}

export function AppShell({ manifest, manifestErrors, children }: Props) {
  const multiPage = manifest.pages.length > 1;
  const banner = <ManifestErrorBanner errors={manifestErrors} />;
  const hasConnectors = Object.keys(manifest.connectors ?? {}).length > 0;

  if (!multiPage) {
    return (
      <div className="mx-auto max-w-[1100px] px-5 pt-8 pb-20">
        {hasConnectors ? (
          <div className="mb-2 flex justify-end">
            <ConnectionsButton />
          </div>
        ) : null}
        {banner}
        {children}
      </div>
    );
  }

  return (
    <Sidebar.Provider defaultOpen collapsible="icon" className="h-full">
      <Sidebar>
        <Sidebar.Header>
          <Text variant="heading3" as="span" className="truncate tracking-tight">
            {manifest.title}
          </Text>
        </Sidebar.Header>
        <Sidebar.Content>
          <Sidebar.Group>
            <PageNav manifest={manifest} />
          </Sidebar.Group>
        </Sidebar.Content>
        <Sidebar.Footer>
          <div className="flex items-center justify-between gap-2">
            <Sidebar.Trigger />
            {hasConnectors ? <ConnectionsButton /> : null}
          </div>
          <Text variant="secondary" size="sm" className="truncate">
            OpenIslands
          </Text>
        </Sidebar.Footer>
        <Sidebar.Rail />
      </Sidebar>
      <main className="min-w-0 flex-1 overflow-y-auto px-6 pt-6 pb-20">
        <div className="mb-4 flex items-center gap-2 md:hidden">
          <Sidebar.Trigger />
          <Text variant="heading3" as="span" className="truncate tracking-tight">
            {manifest.title}
          </Text>
        </div>
        {banner}
        {children}
      </main>
    </Sidebar.Provider>
  );
}
