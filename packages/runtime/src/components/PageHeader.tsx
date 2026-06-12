import type { ReactNode } from "react";
import { Breadcrumbs, Tabs, type TabsItem } from "@cloudflare/kumo";
import { Link } from "@tanstack/react-router";
import type { Group, Page } from "@openislands/schema";
import { useAppId } from "../client/useAppId.js";

interface Props {
  appTitle: string;
  page: Page;
  activeGroup?: string;
  filters?: ReactNode;
}

function groupTabs(
  appId: string,
  pageId: string,
  groups: Group[],
  activeGroup: string | undefined,
): TabsItem[] {
  return groups.map((group) => ({
    value: group.id,
    label: group.title ?? group.id,
    render: (props) => (
      <Link
        {...props}
        to="/$appId/$pageId"
        params={{ appId, pageId }}
        search={{ group: group.id }}
        data-active={group.id === activeGroup ? "" : undefined}
      />
    ),
  }));
}

export function PageHeader({ appTitle, page, activeGroup, filters }: Props) {
  const appId = useAppId();
  const tabs = page.groups ? groupTabs(appId, page.id, page.groups, activeGroup) : undefined;
  const title = page.title ?? page.id;
  return (
    <div className="mb-6 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-kumo-line pb-2">
        <Breadcrumbs size="sm">
          <Breadcrumbs.Link href={`/${appId}`}>{appTitle}</Breadcrumbs.Link>
          <Breadcrumbs.Separator />
          <Breadcrumbs.Current>{title}</Breadcrumbs.Current>
        </Breadcrumbs>
        {filters}
      </div>
      {tabs ? (
        <div className="border-b border-kumo-line pb-2">
          <Tabs variant="underline" tabs={tabs} value={activeGroup} />
        </div>
      ) : null}
    </div>
  );
}
