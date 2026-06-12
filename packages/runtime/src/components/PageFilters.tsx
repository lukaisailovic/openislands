import { X } from "@phosphor-icons/react";
import { Button, Text } from "@cloudflare/kumo";
import type { PageFilter } from "@openislands/schema";
import type { RangeBounds } from "../client/pageFilters.js";

interface Props {
  filters: PageFilter[];
  bounds: RangeBounds;
  onChange: (bounds: RangeBounds) => void;
}

const INPUT_CLASS =
  "h-6.5 rounded-md border border-kumo-line bg-kumo-base px-2 text-xs text-kumo-primary " +
  "focus:outline-none focus:ring-[1.5px] focus:ring-kumo-focus/50 [color-scheme:light] dark:[color-scheme:dark]";

/**
 * Page-level date-range controls. v1 renders each `daterange` filter as two
 * compact date inputs and a reset; the active bounds live in the URL so the
 * state is shared by every bound island and survives reloads.
 */
export function PageFilters({ filters, bounds, onChange }: Props) {
  const dateranges = filters.filter((f) => f.type === "daterange");
  if (dateranges.length === 0) return null;
  const active = bounds.from !== undefined || bounds.to !== undefined;

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {dateranges.map((filter) => (
        <div key={filter.id} className="flex items-center gap-2">
          <Text variant="secondary" size="sm">
            {filter.label ?? "Date range"}
          </Text>
          <input
            type="date"
            aria-label={`${filter.label ?? "Date range"} from`}
            className={INPUT_CLASS}
            value={bounds.from ?? ""}
            max={bounds.to}
            onChange={(e) => onChange({ ...bounds, from: e.target.value || undefined })}
          />
          <Text variant="secondary" size="sm">
            to
          </Text>
          <input
            type="date"
            aria-label={`${filter.label ?? "Date range"} to`}
            className={INPUT_CLASS}
            value={bounds.to ?? ""}
            min={bounds.from}
            onChange={(e) => onChange({ ...bounds, to: e.target.value || undefined })}
          />
        </div>
      ))}
      {active ? (
        <Button variant="ghost" size="sm" shape="square" icon={X} aria-label="Reset date range" onClick={() => onChange({})} />
      ) : null}
    </div>
  );
}
