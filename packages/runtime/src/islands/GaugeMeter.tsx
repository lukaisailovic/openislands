import type { CSSProperties } from "react";
import { Meter } from "@cloudflare/kumo";
import type { IslandRenderProps } from "../types.js";
import { resolveMax } from "./gauge.js";
import { toNumber } from "./format.js";

interface MeterConfig {
  value: string;
  max: string | number;
  label?: string;
  color?: string;
}

const PALETTE = ["#0a84ff", "#34c759", "#ff9f0a", "#ff375f"];

export function GaugeMeter({ config, data }: IslandRenderProps) {
  const row = (data?.rows ?? []).at(-1) ?? {};
  const meters = (config.meters ?? []) as MeterConfig[];

  return (
    <div className="flex flex-col justify-center gap-4">
      {meters.map((meter, i) => {
        const value = toNumber(row[meter.value]) ?? 0;
        const max = resolveMax(meter.max, row);
        const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
        const color = meter.color ?? PALETTE[i % PALETTE.length];
        return (
          <Meter
            key={meter.value}
            label={meter.label ?? meter.value}
            value={pct}
            customValue={`${Math.round(value)} / ${Math.round(max)}`}
            style={{ "--gauge-meter-color": color } as CSSProperties}
            indicatorClassName="bg-none bg-(--gauge-meter-color)"
          />
        );
      })}
    </div>
  );
}
