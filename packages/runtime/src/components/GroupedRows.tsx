import { Badge, Collapsible, Text, cn } from "@cloudflare/kumo";
import { CaretRight } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import type { Row } from "../types.js";
import { ROW_INTERACTIVE_CLASS } from "./RowDetailsDialog.js";
import { SeeAllDialog } from "./SeeAllDialog.js";

export interface GroupBySpec {
  field: string;
  titleField?: string;
  subtitleField?: string;
}

const EMPTY_GROUP_LABEL = "—";

export interface RowGroup {
  /** the partition key — `String(row[field])`, or the empty-group label */
  key: string;
  title: string;
  subtitle?: string;
  rows: Row[];
}

/**
 * Partitions rows by `spec.field`, preserving order of first appearance (data
 * order is authoritative — never sorted). Title/subtitle are read from each
 * group's first row; an empty/missing group value collapses under "—". Pure,
 * so tests assert without a DOM.
 */
export function groupRows(rows: Row[], spec: GroupBySpec): RowGroup[] {
  const byKey = new Map<string, RowGroup>();
  for (const row of rows) {
    const raw = row[spec.field];
    const present = raw !== null && raw !== undefined && String(raw) !== "";
    const key = present ? String(raw) : EMPTY_GROUP_LABEL;
    const existing = byKey.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    const titleValue = spec.titleField ? row[spec.titleField] : undefined;
    const subtitleValue = spec.subtitleField ? row[spec.subtitleField] : undefined;
    byKey.set(key, {
      key,
      title: titleValue !== null && titleValue !== undefined && String(titleValue) !== "" ? String(titleValue) : key,
      subtitle: subtitleValue !== null && subtitleValue !== undefined ? String(subtitleValue) || undefined : undefined,
      rows: [row],
    });
  }
  return [...byKey.values()];
}

function Section({
  group,
  defaultOpen,
  children,
}: {
  group: RowGroup;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger
        className={cn(
          "flex w-full items-center gap-2.5 border-b border-kumo-hairline py-2 text-left",
          ROW_INTERACTIVE_CLASS,
        )}
      >
        <CaretRight
          size={14}
          className={cn(
            "flex-none text-kumo-subtle transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <Text size="sm" as="span" className="font-medium">
          {group.title}
        </Text>
        {group.subtitle ? (
          <Text variant="secondary" size="sm" as="span">
            {group.subtitle}
          </Text>
        ) : null}
        <Badge variant="secondary" className="ml-auto">
          {group.rows.length}
        </Badge>
      </Collapsible.Trigger>
      <Collapsible.Panel className="py-1">{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}

/**
 * Renders row groups as Kumo Collapsible sections — the first expanded, the
 * rest collapsed. The shared section chrome (header, count badge, rotating
 * chevron) lives here so neither island repeats it; each island passes a
 * `children` renderer for the group body.
 */
export function GroupedSections({
  groups,
  children,
}: {
  groups: RowGroup[];
  children: (group: RowGroup) => ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {groups.map((group, i) => (
        <Section key={group.key} group={group} defaultOpen={i === 0}>
          {children(group)}
        </Section>
      ))}
    </div>
  );
}

/**
 * The grouped layout shared by `table.grid` and `timeline.feed`: the first
 * `groupCap` sections inline, and — when there are more — a "see all" dialog
 * holding every group. `wrapSections` lets an island wrap the inline sections
 * (e.g. the table's horizontal-scroll container) without affecting the dialog.
 */
export function GroupedRowsView({
  groups,
  groupCap,
  title,
  expand = true,
  dialogWidth,
  wrapSections = (sections) => sections,
  children,
}: {
  groups: RowGroup[];
  groupCap: number;
  title: string;
  expand?: boolean;
  dialogWidth?: string;
  wrapSections?: (sections: ReactNode) => ReactNode;
  children: (group: RowGroup) => ReactNode;
}) {
  const visible = expand ? groups.slice(0, groupCap) : groups;
  return (
    <>
      {wrapSections(<GroupedSections groups={visible}>{children}</GroupedSections>)}
      {expand && groups.length > groupCap ? (
        <SeeAllDialog label={`See all ${groups.length} groups`} title={title} width={dialogWidth}>
          <GroupedSections groups={groups}>{children}</GroupedSections>
        </SeeAllDialog>
      ) : null}
    </>
  );
}
