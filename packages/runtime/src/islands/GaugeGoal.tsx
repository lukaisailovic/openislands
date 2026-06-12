import { Badge, Tooltip } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { IslandRenderProps } from "../types.js";
import { CENTER, EASE_OUT, FILL_MS, GaugeRing, SIZE, useMountedFill, usePrefersReducedMotion } from "./gauge.js";
import { formatValue, toNumber } from "./format.js";

interface GoalSpec {
  min?: string | number;
  max?: string | number;
}

const STROKE = 18;
const RADIUS = CENTER - STROKE / 2;

const TONE = {
  within: { stroke: "var(--color-kumo-success)", badge: "success" as const, text: "Within goal" },
  under: { stroke: "var(--color-kumo-warning)", badge: "warning" as const, text: "Under goal" },
  over: { stroke: "var(--color-kumo-danger)", badge: "error" as const, text: "Over goal" },
};

type Status = keyof typeof TONE;

function resolveBound(bound: string | number | undefined, row: Record<string, unknown>): number | null {
  if (bound === undefined) return null;
  if (typeof bound === "number") return bound;
  return toNumber(row[bound]);
}

function classify(value: number, min: number | null, max: number | null): Status {
  if (max !== null && value > max) return "over";
  if (min !== null && value < min) return "under";
  return "within";
}

function fillFraction(value: number, min: number | null, max: number | null): number {
  const target = max ?? min;
  if (target === null || target <= 0) return 0;
  return Math.max(0, Math.min(value / target, 1));
}

export function GaugeGoal({ config, data }: IslandRenderProps) {
  const rows = data?.rows ?? [];
  const row = rows.at(-1) ?? {};
  const format = config.format as ValueFormat | undefined;
  const goal = (config.goal ?? {}) as GoalSpec;
  const reducedMotion = usePrefersReducedMotion();
  const filled = useMountedFill() || reducedMotion;

  const value = toNumber(row[config.value as string]) ?? 0;
  const min = resolveBound(goal.min, row);
  const max = resolveBound(goal.max, row);
  const status = classify(value, min, max);
  const tone = TONE[status];
  const fraction = fillFraction(value, min, max);

  const display = formatValue(row[config.value as string] ?? null, format);
  const label = (config.label as string | undefined) ?? (config.unit as string | undefined);

  const goalText =
    min !== null && max !== null
      ? `${formatValue(min, format)}–${formatValue(max, format)}`
      : max !== null
        ? `≤ ${formatValue(max, format)}`
        : `≥ ${formatValue(min ?? 0, format)}`;
  const tooltip = `${display} (goal ${goalText})`;

  return (
    <div
      className="flex flex-col items-center gap-3"
      data-testid="gauge-goal"
      data-status={status}
    >
      <Tooltip content={tooltip} render={<div />}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={(config.title as string) ?? "Goal gauge"}
        >
          <GaugeRing
            radius={RADIUS}
            stroke={STROKE}
            color={tone.stroke}
            fraction={fraction}
            filled={filled}
            transition={reducedMotion ? undefined : `stroke-dashoffset ${FILL_MS}ms ${EASE_OUT}`}
          />
          <text
            x={CENTER}
            y={CENTER}
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
            fontSize="28"
            fontWeight="600"
          >
            {display}
          </text>
        </svg>
      </Tooltip>
      <div className="flex flex-col items-center gap-1.5">
        {label ? <span className="text-sm font-medium opacity-80">{label}</span> : null}
        <Badge variant={tone.badge}>{tone.text}</Badge>
      </div>
    </div>
  );
}
