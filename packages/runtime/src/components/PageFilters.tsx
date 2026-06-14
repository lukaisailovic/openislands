import { useState } from "react";
import { CalendarDots, Funnel, X } from "@phosphor-icons/react";
import { Button, Checkbox, DatePicker, Popover, Select, type DateRange } from "@cloudflare/kumo";
import type { PageFilter } from "@openislands/schema";
import type { RangeBounds } from "../client/pageFilters.js";
import { formatValue } from "../islands/format.js";

interface Props {
  filters: PageFilter[];
  bounds: RangeBounds;
  onChangeBounds: (bounds: RangeBounds) => void;
  selected: Record<string, string[]>;
  onChangeSelect: (filterId: string, values: string[]) => void;
  options: Record<string, string[]>;
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

function DateRangeControl({
  filter,
  bounds,
  onChange,
}: {
  filter: PageFilter;
  bounds: RangeBounds;
  onChange: (bounds: RangeBounds) => void;
}) {
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

const ALL_VALUE = "__all__";

function selectSummary(values: string[]): string {
  if (values.length === 0) return "All";
  if (values.length === 1) return values[0]!;
  return `${values.length} selected`;
}

/**
 * A single `type:"select"` filter. A single-value filter is a Kumo `Select`
 * with an "All" option that clears it; a `multiple` filter is a `Popover` of
 * checkbox toggles, which keeps the chosen array fully controlled and writes it
 * straight back through `onChange`. Either way the state lives in the URL.
 */
function SelectControl({
  filter,
  values,
  options,
  onChange,
}: {
  filter: PageFilter & { type: "select" };
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  const label = filter.label ?? filter.id;

  if (filter.multiple) {
    const toggle = (option: string, checked: boolean) => {
      onChange(checked ? [...values, option] : values.filter((v) => v !== option));
    };
    return (
      <Popover>
        <Popover.Trigger render={<Button variant="outline" size="sm" icon={Funnel} />}>
          {label}: {selectSummary(values)}
        </Popover.Trigger>
        <Popover.Content className="flex max-h-80 min-w-44 flex-col gap-1 overflow-auto p-2">
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-md px-2 py-1.5 text-left text-sm text-kumo-subtle hover:bg-kumo-control"
          >
            All
          </button>
          {options.map((option) => (
            <Checkbox
              key={option}
              label={option}
              checked={values.includes(option)}
              onCheckedChange={(checked) => toggle(option, checked === true)}
            />
          ))}
        </Popover.Content>
      </Popover>
    );
  }

  const selectValue = (next: unknown) => {
    onChange(next === ALL_VALUE || typeof next !== "string" ? [] : [next]);
  };

  return (
    <Select
      size="sm"
      aria-label={label}
      value={values[0] ?? ALL_VALUE}
      onValueChange={selectValue}
      renderValue={() => `${label}: ${selectSummary(values)}`}
    >
      <Select.Option value={ALL_VALUE}>All</Select.Option>
      {options.map((option) => (
        <Select.Option key={option} value={option}>
          {option}
        </Select.Option>
      ))}
    </Select>
  );
}

/**
 * Page-level filter controls. Each `select` filter renders a `SelectControl`
 * and each `daterange` filter a `DateRangeControl`, side by side in the page
 * header; all state lives in the URL so it's shared by every bound island and
 * survives reloads. Renders nothing when the page declares no supported filter.
 */
export function PageFilters({ filters, bounds, onChangeBounds, selected, onChangeSelect, options }: Props) {
  const selects = filters.filter((f) => f.type === "select");
  const dateranges = filters.filter((f) => f.type === "daterange");
  if (selects.length === 0 && dateranges.length === 0) return null;
  const rangeActive = bounds.from !== undefined || bounds.to !== undefined;

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {selects.map((filter) => (
        <SelectControl
          key={filter.id}
          filter={filter}
          values={selected[filter.id] ?? []}
          options={options[filter.id] ?? filter.options ?? []}
          onChange={(values) => onChangeSelect(filter.id, values)}
        />
      ))}
      {dateranges.map((filter) => (
        <DateRangeControl key={filter.id} filter={filter} bounds={bounds} onChange={onChangeBounds} />
      ))}
      {rangeActive ? (
        <Button variant="ghost" size="sm" shape="square" icon={X} aria-label="Reset date range" onClick={() => onChangeBounds({})} />
      ) : null}
    </div>
  );
}
