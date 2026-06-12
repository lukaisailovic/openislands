import { useState } from "react";
import { CalendarDots, X } from "@phosphor-icons/react";
import { Button, DatePicker, Popover, type DateRange } from "@cloudflare/kumo";
import type { PageFilter } from "@openislands/schema";
import type { RangeBounds } from "../client/pageFilters.js";
import { formatValue } from "../islands/format.js";

interface Props {
  filters: PageFilter[];
  bounds: RangeBounds;
  onChange: (bounds: RangeBounds) => void;
}

interface Preset {
  label: string;
  bounds: Required<RangeBounds>;
}

const pad = (n: number) => String(n).padStart(2, "0");

function toDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDay(day: string | undefined): Date | undefined {
  if (day === undefined) return undefined;
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date);
}

function daysAgo(today: Date, days: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
}

function buildPresets(today: Date): Preset[] {
  const span = (from: Date, to: Date) => ({ from: toDay(from), to: toDay(to) });
  return [
    { label: "Today", bounds: span(today, today) },
    { label: "Last 7 days", bounds: span(daysAgo(today, 6), today) },
    { label: "Last 30 days", bounds: span(daysAgo(today, 29), today) },
    { label: "Last 90 days", bounds: span(daysAgo(today, 89), today) },
    {
      label: "This month",
      bounds: span(new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    },
    {
      label: "Last month",
      bounds: span(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)),
    },
  ];
}

const boundLabel = (value: string | undefined) => (value === undefined ? "…" : formatValue(value, "date"));

function rangeLabel(bounds: RangeBounds): string {
  if (bounds.from === undefined && bounds.to === undefined) return "All time";
  return `${boundLabel(bounds.from)} – ${boundLabel(bounds.to)}`;
}

function DateRangeControl({ filter, bounds, onChange }: { filter: PageFilter } & Omit<Props, "filters">) {
  const [month, setMonth] = useState<Date | undefined>(() => parseDay(bounds.from));
  const presets = buildPresets(new Date());
  const selected: DateRange | undefined =
    bounds.from === undefined && bounds.to === undefined
      ? undefined
      : { from: parseDay(bounds.from), to: parseDay(bounds.to) };

  const selectRange = (range: DateRange | undefined) => {
    onChange({
      from: range?.from ? toDay(range.from) : undefined,
      to: range?.to ? toDay(range.to) : undefined,
    });
  };

  const selectPreset = (preset: Preset) => {
    onChange(preset.bounds);
    setMonth(parseDay(preset.bounds.from));
  };

  return (
    <Popover>
      <Popover.Trigger render={<Button variant="outline" size="sm" icon={CalendarDots} />}>
        {filter.label ?? "Date range"}: {rangeLabel(bounds)}
      </Popover.Trigger>
      <Popover.Content className="p-0">
        <div className="flex">
          <div className="flex flex-col gap-1 border-r border-kumo-line p-2 text-sm">
            {presets.map((preset) => {
              const active = bounds.from === preset.bounds.from && bounds.to === preset.bounds.to;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  className={`rounded-md px-3 py-1.5 text-left whitespace-nowrap ${
                    active ? "bg-kumo-contrast text-kumo-inverse" : "text-kumo-subtle hover:bg-kumo-control"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="p-3">
            <DatePicker mode="range" selected={selected} onChange={selectRange} month={month} onMonthChange={setMonth} numberOfMonths={2} />
          </div>
        </div>
      </Popover.Content>
    </Popover>
  );
}

/**
 * Page-level date-range controls. v1 renders each `daterange` filter as a
 * popover combining preset ranges with a two-month range calendar; the active
 * bounds live in the URL so the state is shared by every bound island and
 * survives reloads.
 */
export function PageFilters({ filters, bounds, onChange }: Props) {
  const dateranges = filters.filter((f) => f.type === "daterange");
  if (dateranges.length === 0) return null;
  const active = bounds.from !== undefined || bounds.to !== undefined;

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {dateranges.map((filter) => (
        <DateRangeControl key={filter.id} filter={filter} bounds={bounds} onChange={onChange} />
      ))}
      {active ? (
        <Button variant="ghost" size="sm" shape="square" icon={X} aria-label="Reset date range" onClick={() => onChange({})} />
      ) : null}
    </div>
  );
}
