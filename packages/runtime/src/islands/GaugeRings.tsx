import { Tooltip } from "@cloudflare/kumo";
import type { IslandRenderProps } from "../types.js";
import { CENTER, EASE_OUT, FILL_MS, GaugeRing, resolveMax, SIZE, useMountedFill, usePrefersReducedMotion } from "./gauge.js";
import { toNumber } from "./format.js";

interface RingConfig {
  value: string;
  max: string | number;
  label?: string;
  color?: string;
  direction?: "atLeast" | "atMost";
}

const PALETTE = ["#34c759", "#ff9f0a", "#ff375f", "#0a84ff"];
const DANGER = "#ff375f";
const GAP = 6;
/** Fraction of the radius kept clear at the center so the % label always fits. */
const CENTER_CLEARANCE = 0.34;
const STAGGER_MS = 90;

/**
 * Stroke thickness adapts to ring count so the innermost radius never drops
 * below the center clearance: fewer rings render thicker (no hollow donut),
 * more rings render thinner. With the schema's max of 4 rings this always
 * leaves room for the center label.
 */
function ringStroke(count: number): number {
  const usable = CENTER * (1 - CENTER_CLEARANCE) - GAP * (count - 1);
  return usable / count;
}

export function GaugeRings({ config, data }: IslandRenderProps) {
  const rows = data?.rows ?? [];
  const row = rows.at(-1) ?? {};
  const rings = (config.rings ?? []) as RingConfig[];
  const reducedMotion = usePrefersReducedMotion();
  const filled = useMountedFill() || reducedMotion;
  const stroke = ringStroke(rings.length);

  const tracks = rings.map((ring, i) => {
    const value = toNumber(row[ring.value]) ?? 0;
    const max = resolveMax(ring.max, row);
    const pct = max > 0 ? Math.min(value / max, 1) : 0;
    const radius = CENTER - stroke / 2 - i * (stroke + GAP);
    const label = ring.label ?? ring.value;
    const isBudget = ring.direction === "atMost";
    const overBudget = isBudget && max > 0 && value > max;
    const baseColor = ring.color ?? PALETTE[i % PALETTE.length]!;
    const limitLabel = isBudget ? " limit" : "";
    return {
      key: ring.value,
      label,
      value,
      max,
      pct,
      radius,
      color: overBudget ? DANGER : baseColor,
      tooltip: `${label}: ${Math.round(value)} / ${Math.round(max)}${limitLabel} (${Math.round(pct * 100)}%)`,
      transition: reducedMotion
        ? undefined
        : `stroke-dashoffset ${FILL_MS}ms ${EASE_OUT} ${i * STAGGER_MS}ms`,
    };
  });

  const primary = tracks[0];
  const innermost = tracks.at(-1);
  const centerHole = innermost ? innermost.radius - stroke / 2 : 0;
  const hasCenterRoom = centerHole >= CENTER * CENTER_CLEARANCE;
  const labelSize = Math.round(centerHole * 0.65);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-around">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={(config.title as string) ?? "Gauge rings"}
      >
        {tracks.map((t) => (
          <Tooltip key={t.key} content={t.tooltip} render={<g />}>
            <GaugeRing
              radius={t.radius}
              stroke={stroke}
              color={t.color}
              fraction={t.pct}
              filled={filled}
              transition={t.transition}
            />
          </Tooltip>
        ))}
        {primary && hasCenterRoom ? (
          <text
            x={CENTER}
            y={CENTER}
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
            fontSize={labelSize}
            fontWeight="600"
          >
            {Math.round(primary.pct * 100)}%
          </text>
        ) : null}
      </svg>

      <ul className="flex flex-col gap-2 text-sm">
        {tracks.map((t) => (
          <Tooltip key={t.key} content={t.tooltip} render={<li className="flex items-center gap-2" />}>
            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="font-medium">{t.label}</span>
            <span className="tabular-nums opacity-70">
              {Math.round(t.value)} / {Math.round(t.max)}
            </span>
          </Tooltip>
        ))}
      </ul>
    </div>
  );
}
