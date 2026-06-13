import { Badge, Text } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { formatValue } from "./format.js";

type Tone = "success" | "warning" | "danger" | "neutral";

interface StatusSpec {
  label: string;
  state: string;
  value?: string;
  format?: ValueFormat;
  tones?: Record<string, Tone>;
}

export interface StatusTile {
  label: string;
  state: string;
  value: string | null;
  tone: Tone;
}

const TONE_KEYWORDS: Record<string, Tone> = {
  up: "success",
  ok: "success",
  healthy: "success",
  online: "success",
  success: "success",
  operational: "success",
  warn: "warning",
  warning: "warning",
  degraded: "warning",
  pending: "warning",
  down: "danger",
  error: "danger",
  critical: "danger",
  fail: "danger",
  failed: "danger",
  offline: "danger",
};

// The dot appearance only renders its indicator for success/warning/error/neutral,
// so neutral maps to the neutral variant (not secondary) to keep the dot.
const BADGE_VARIANT: Record<Tone, "success" | "warning" | "error" | "neutral"> = {
  success: "success",
  warning: "warning",
  danger: "error",
  neutral: "neutral",
};

function readSpec(config: IslandRenderProps["config"]): StatusSpec {
  return {
    label: config.label as string,
    state: config.state as string,
    value: config.value as string | undefined,
    format: config.format as ValueFormat | undefined,
    tones: config.tones as Record<string, Tone> | undefined,
  };
}

/** Resolve a state value to a tone: an explicit `tones` override wins, else a keyword convention, else neutral. */
export function toneFor(state: string, tones?: Record<string, Tone>): Tone {
  if (tones && tones[state] !== undefined) return tones[state]!;
  return TONE_KEYWORDS[state.toLowerCase().trim()] ?? "neutral";
}

/** One tile per row, tone resolved from its state. Pure, so tests assert without a DOM. */
export function buildStatusTiles(spec: StatusSpec, rows: Row[]): StatusTile[] {
  return rows.map((row) => {
    const state = String(row[spec.state] ?? "");
    return {
      label: String(row[spec.label] ?? ""),
      state,
      value: spec.value ? formatValue(row[spec.value] ?? null, spec.format) : null,
      tone: toneFor(state, spec.tones),
    };
  });
}

export function StatusGrid({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  if (rows.length === 0) return <NoData />;

  const tiles = buildStatusTiles(spec, rows);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map((tile, i) => (
        <div
          key={`${tile.label}-${i}`}
          className="flex flex-col gap-2 rounded-md border border-kumo-hairline bg-kumo-recessed p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <Text variant="secondary" size="sm" DANGEROUS_className="truncate">
              {tile.label}
            </Text>
            <Badge variant={BADGE_VARIANT[tile.tone]} appearance="dot">
              {tile.state}
            </Badge>
          </div>
          {tile.value !== null ? (
            <Text variant="heading3" as="span" DANGEROUS_className="font-medium tabular-nums tracking-tight">
              {tile.value}
            </Text>
          ) : null}
        </div>
      ))}
    </div>
  );
}
