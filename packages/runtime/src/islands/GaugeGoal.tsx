import { Badge, Tooltip } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { IslandRenderProps } from "../types.js";
import { CENTER, EASE_OUT, FILL_MS, GaugeRing, SIZE, useMountedFill, usePrefersReducedMotion } from "./gauge.js";
import { formatValue, type Row, toNumber } from "./format.js";

interface GoalSpec {
  value: string;
  goal?: { min?: string | number; max?: string | number };
  label?: string;
  unit?: string;
  format?: ValueFormat;
}

const STROKE = 18;
const RADIUS = CENTER - STROKE / 2;

const TONE = {
  within: { stroke: "var(--color-kumo-success)", badge: "success" as const, text: "Within goal" },
  under: { stroke: "var(--color-kumo-warning)", badge: "warning" as const, text: "Under goal" },
  over: { stroke: "var(--color-kumo-danger)", badge: "error" as const, text: "Over goal" },
};

type Status = keyof typeof TONE;

type Size = "small" | "medium" | "large";

interface SizeSpec {
  svg: number;
  rootGap: string;
  metaGap: string;
  labelClass: string;
  compactStatus: boolean;
}

const SIZES: Record<Size, SizeSpec> = {
  small: { svg: 88, rootGap: "gap-2", metaGap: "gap-1", labelClass: "text-xs font-medium opacity-80", compactStatus: true },
  medium: { svg: 150, rootGap: "gap-3", metaGap: "gap-1.5", labelClass: "text-sm font-medium opacity-80", compactStatus: false },
  large: { svg: 210, rootGap: "gap-4", metaGap: "gap-2", labelClass: "text-base font-medium opacity-80", compactStatus: false },
};

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

interface GoalRingProps {
  goal: GoalSpec;
  row: Row;
  sizeSpec: SizeSpec;
  filled: boolean;
  reducedMotion: boolean;
}

function GoalRing({ goal, row, sizeSpec, filled, reducedMotion }: GoalRingProps) {
  const bounds = goal.goal ?? {};
  const value = toNumber(row[goal.value]) ?? 0;
  const min = resolveBound(bounds.min, row);
  const max = resolveBound(bounds.max, row);
  const status = classify(value, min, max);
  const tone = TONE[status];
  const fraction = fillFraction(value, min, max);

  const display = formatValue(row[goal.value] ?? null, goal.format);
  const label = goal.label ?? goal.unit;

  const goalText =
    min !== null && max !== null
      ? `${formatValue(min, goal.format)}–${formatValue(max, goal.format)}`
      : max !== null
        ? `≤ ${formatValue(max, goal.format)}`
        : `≥ ${formatValue(min ?? 0, goal.format)}`;
  const tooltip = `${display} (goal ${goalText})`;

  return (
    <div
      className={`flex flex-col items-center ${sizeSpec.rootGap}`}
      data-testid="gauge-goal-ring"
      data-status={status}
    >
      <Tooltip content={tooltip} render={<div />}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={sizeSpec.svg}
          height={sizeSpec.svg}
          role="img"
          aria-label={goal.label ?? goal.value}
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
      <div className={`flex flex-col items-center ${sizeSpec.metaGap}`}>
        {label ? <span className={sizeSpec.labelClass}>{label}</span> : null}
        {sizeSpec.compactStatus ? (
          <Tooltip content={tone.text} render={<div />}>
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: tone.stroke }}
              role="img"
              aria-label={tone.text}
            />
          </Tooltip>
        ) : (
          <Badge variant={tone.badge}>{tone.text}</Badge>
        )}
      </div>
    </div>
  );
}

export function GaugeGoal({ config, data }: IslandRenderProps) {
  const row: Row = (data?.rows ?? []).at(-1) ?? {};
  const goals = (config.goals ?? []) as GoalSpec[];
  const size = (config.size as Size | undefined) ?? "medium";
  const sizeSpec = SIZES[size];
  const reducedMotion = usePrefersReducedMotion();
  const filled = useMountedFill() || reducedMotion;

  return (
    <div
      className="flex h-full flex-wrap content-center items-center justify-center gap-x-6 gap-y-5"
      data-testid="gauge-goal"
      data-size={size}
    >
      {goals.map((goal, i) => (
        <GoalRing
          key={`${goal.value}-${i}`}
          goal={goal}
          row={row}
          sizeSpec={sizeSpec}
          filled={filled}
          reducedMotion={reducedMotion}
        />
      ))}
    </div>
  );
}
