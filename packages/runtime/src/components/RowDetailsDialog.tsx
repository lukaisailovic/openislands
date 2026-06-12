import { Button, Dialog, SkeletonLine, Text } from "@cloudflare/kumo";
import { X } from "@phosphor-icons/react";
import type { ValueFormat } from "@openislands/schema";
import { type KeyboardEvent, useState } from "react";
import { type MatchPair, useDrilldownQuery } from "../client/useIslandQuery.js";
import { resolveDrilldownRenderer } from "../islands/drilldownRenderer.js";
import type { IslandConfig, Row } from "../types.js";
import { formatTimestamp, formatValue } from "../islands/format.js";

export interface RowField {
  field: string;
  label?: string;
  format?: ValueFormat;
  /** render via the feed's smart timestamp formatter (date vs datetime) */
  smartTimestamp?: boolean;
}

/** A drilldown island embedded in the dialog, its rows filtered to the clicked row. */
export interface DrilldownSpec {
  island: IslandConfig;
  /** drilldown-dataset column → clicked-row field whose value filters the embedded island */
  match: Record<string, string>;
}

/**
 * Native-Kumo interactive row chrome, matching Sidebar.MenuButton: a rounded
 * tint on hover, inset off the card edge so the highlight floats, a 150ms color
 * transition, and a keyboard focus ring. Reduced motion drops the transition.
 */
export const ROW_INTERACTIVE_CLASS =
  "cursor-pointer rounded-lg -mx-2 px-2 transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kumo-brand";

/**
 * The same affordance for a table `<tr>`, where rounding and inset live on the
 * row's edge cells (a `<tr>` can't carry a radius or negative margin).
 */
export const ROW_INTERACTIVE_TABLE_CLASS =
  "cursor-pointer transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kumo-brand [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg";

function fieldText(field: RowField, value: Row[string]): string {
  if (field.smartTimestamp) return formatTimestamp(value ?? null);
  if (field.format) return formatValue(value ?? null, field.format);
  return String(value ?? "");
}

/** Click + keyboard activation props for a row that opens its details. */
export function rowActivationProps(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onActivate();
    },
  };
}

/**
 * Wires a row-details dialog: a row is clickable when it has detail fields or a
 * drilldown to embed. Returns the row click handler (undefined when neither is
 * configured) and the dialog element, so an island renders both without
 * repeating the state.
 */
export function useRowDetails(
  details: RowField[],
  fields: RowField[],
  title: string,
  drilldown?: DrilldownSpec,
) {
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
  if (details.length === 0 && !drilldown) return { onRowClick: undefined, dialog: null };
  return {
    onRowClick: setSelectedRow,
    dialog: (
      <RowDetailsDialog
        row={selectedRow}
        fields={fields}
        title={title}
        drilldown={drilldown}
        onClose={() => setSelectedRow(null)}
      />
    ),
  };
}

function matchPairs(drilldown: DrilldownSpec, row: Row): MatchPair[] {
  return Object.entries(drilldown.match).map(([field, parentField]) => ({
    field,
    value: String(row[parentField] ?? ""),
  }));
}

/** The drilldown island, fetched filtered to the clicked row and rendered like IslandTile does. */
function DrilldownSection({ drilldown, row }: { drilldown: DrilldownSpec; row: Row }) {
  const dataset = (drilldown.island.dataset as string | undefined) ?? "";
  const result = useDrilldownQuery(dataset, matchPairs(drilldown, row), true);
  const Renderer = resolveDrilldownRenderer(drilldown.island.type);
  const heading = drilldown.island.title as string | undefined;
  const config = { ...drilldown.island, expand: false };

  return (
    <div className="mt-5 border-t border-kumo-hairline pt-5">
      {heading ? (
        <Text size="sm" as="p" className="mb-3 font-medium text-kumo-strong">
          {heading}
        </Text>
      ) : null}
      {result.isLoading ? (
        <div className="flex flex-col gap-2">
          <SkeletonLine />
          <SkeletonLine />
          <SkeletonLine minWidth={50} maxWidth={70} />
        </div>
      ) : Renderer ? (
        <Renderer config={config} data={result.data} />
      ) : null}
    </div>
  );
}

/**
 * The expanded view of a single row: every primary field plus the island's
 * `details` fields as a definition list, and an optional drilldown island
 * filtered to the row. Controlled — open while `row` is set.
 */
export function RowDetailsDialog({
  row,
  fields,
  title,
  drilldown,
  onClose,
}: {
  row: Row | null;
  fields: RowField[];
  title: string;
  drilldown?: DrilldownSpec;
  onClose: () => void;
}) {
  const width = drilldown ? "w-[min(92vw,44rem)]" : "w-[min(92vw,28rem)]";
  return (
    <Dialog.Root
      open={row !== null}
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <Dialog size="sm" className={`t-modal ${width} flex max-h-[85vh] flex-col p-6`}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <Dialog.Title className="text-base font-medium">{title}</Dialog.Title>
          <Dialog.Close
            aria-label="Close"
            render={(props) => (
              <Button {...props} variant="ghost" size="sm" shape="square" aria-label="Close">
                <X size={14} />
              </Button>
            )}
          />
        </div>
        {row ? (
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 text-[14px]/[20px]">
            {fields.length > 0 ? (
              <dl className="flex flex-col gap-3 text-sm">
                {fields.map((f) => (
                  <div key={f.field}>
                    <dt className="text-kumo-subtle">{f.label ?? f.field}</dt>
                    <dd className="mt-0.5">
                      <Text size="sm" className="break-words whitespace-pre-wrap">
                        {fieldText(f, row[f.field])}
                      </Text>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {drilldown ? <DrilldownSection drilldown={drilldown} row={row} /> : null}
          </div>
        ) : null}
      </Dialog>
    </Dialog.Root>
  );
}
