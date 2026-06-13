import type { ValueFormat } from "@openislands/schema";
import type { Row, Scalar } from "@openislands/compiler";

export type { Row, Scalar };

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export interface Delta {
  pct: number;
  direction: "up" | "down";
}

/** Percentage change of the latest value against the previous row's value. */
export function computeDelta(current: Scalar, previous: Scalar): Delta | null {
  const cur = toNumber(current);
  const prev = toNumber(previous);
  if (cur === null || prev === null || prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return { pct, direction: pct >= 0 ? "up" : "down" };
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  hasTime: boolean;
}

/**
 * Parses a Date, ISO string, or `YYYY-MM-DD[ HH:MM:SS]` into plain calendar
 * parts without applying a timezone, so SSR and client render the same wall
 * clock the data carries. `hasTime` is false for a date-only value, letting
 * the feed pick `date` over `datetime`.
 */
function parseDateParts(value: Scalar | Date): DateParts | null {
  if (value instanceof Date) {
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
      hour: value.getUTCHours(),
      minute: value.getUTCMinutes(),
      second: value.getUTCSeconds(),
      hasTime: true,
    };
  }
  if (typeof value !== "string") return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
    hasTime: m[4] !== undefined,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateParts(p: DateParts, kind: "date" | "datetime" | "time" | "month"): string {
  const month = MONTHS[p.month - 1] ?? p.month;
  const date = `${month} ${p.day}, ${p.year}`;
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  if (kind === "date") return date;
  if (kind === "time") return time;
  if (kind === "month") return `${month} ${p.year}`;
  return `${month} ${p.day}, ${time}`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** Binary 1024-scale byte size; whole bytes, one decimal for larger units. */
function formatBytes(n: number): string {
  const sign = n < 0 ? "-" : "";
  let value = Math.abs(n);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${sign}${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

const DURATION_UNITS: ReadonlyArray<[label: string, seconds: number]> = [
  ["d", 86400],
  ["h", 3600],
  ["m", 60],
  ["s", 1],
];

/** A number of seconds as the two largest non-zero units, e.g. `1h 5m`. */
function formatDuration(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  let remaining = Math.round(Math.abs(totalSeconds));
  const parts: string[] = [];
  for (const [label, seconds] of DURATION_UNITS) {
    if (parts.length === 2) break;
    const amount = Math.floor(remaining / seconds);
    if (amount === 0 && parts.length === 0) continue;
    if (amount === 0) break;
    parts.push(`${amount}${label}`);
    remaining -= amount * seconds;
  }
  if (parts.length === 0) return "0s";
  return `${sign}${parts.join(" ")}`;
}

function currency(n: number, locale: string, code: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * The `ts` field of a timeline feed, rendered without explicit config: a
 * date-only value (or a midnight timestamp) shows as a date, anything with a
 * wall-clock time shows date + time.
 */
export function formatTimestamp(value: Scalar): string {
  const parts = parseDateParts(value);
  if (parts === null) return String(value ?? "");
  const isMidnight = parts.hour === 0 && parts.minute === 0 && parts.second === 0;
  return formatDateParts(parts, !parts.hasTime || isMidnight ? "date" : "datetime");
}

/** Render a scalar in one of the manifest's value formats; falls back to a plain string. */
export function formatValue(value: Scalar | Date, format?: ValueFormat): string {
  if (format === "date" || format === "datetime" || format === "time" || format === "month") {
    const parts = parseDateParts(value);
    return parts === null ? String(value ?? "") : formatDateParts(parts, format);
  }
  const n = toNumber(value);
  if (n === null) return String(value ?? "");
  switch (format) {
    case "usd":
      return currency(n, "en-US", "USD");
    case "eur":
      return currency(n, "en-IE", "EUR");
    case "gbp":
      return currency(n, "en-GB", "GBP");
    case "jpy":
      return currency(n, "en-US", "JPY");
    case "pct":
      return `${(n * 100).toFixed(1)}%`;
    case "compact":
      return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
    case "kg":
      return `${n.toFixed(1)} kg`;
    case "bytes":
      return formatBytes(n);
    case "duration":
      return formatDuration(n);
    case "int":
      return new Intl.NumberFormat("en-US").format(Math.round(n));
    default:
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  }
}
