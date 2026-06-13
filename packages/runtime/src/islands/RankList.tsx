import type { CSSProperties } from "react";
import { Meter } from "@cloudflare/kumo";
import type { ValueFormat } from "@openislands/schema";
import type { Row } from "@openislands/compiler";
import { NoData } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";
import { formatValue, toNumber } from "./format.js";

interface RankSpec {
  label: string;
  value: string;
  limit: number;
  sort: "descending" | "ascending";
  secondary?: string;
  color?: string;
  format?: ValueFormat;
}

export interface RankItem {
  label: string;
  value: number;
  secondary?: string;
  pct: number;
}

function readSpec(config: IslandRenderProps["config"]): RankSpec {
  return {
    label: config.label as string,
    value: config.value as string,
    limit: (config.limit as number | undefined) ?? 10,
    sort: config.sort === "ascending" ? "ascending" : "descending",
    secondary: config.secondary as string | undefined,
    color: config.color as string | undefined,
    format: config.format as ValueFormat | undefined,
  };
}

/** Rank rows by value, take the top-N, and size each bar against the visible set's peak. Pure, so tests assert without a DOM. */
export function buildRankItems(spec: RankSpec, rows: Row[]): RankItem[] {
  const ranked = rows
    .map((row) => ({
      label: String(row[spec.label] ?? ""),
      value: toNumber(row[spec.value]) ?? 0,
      secondary: spec.secondary ? String(row[spec.secondary] ?? "") : undefined,
    }))
    .toSorted((a, b) => (spec.sort === "ascending" ? a.value - b.value : b.value - a.value))
    .slice(0, spec.limit);
  const max = Math.max(...ranked.map((r) => Math.abs(r.value)), 0) || 1;
  return ranked.map((r) => ({ ...r, pct: (Math.abs(r.value) / max) * 100 }));
}

export function RankList({ config, data }: IslandRenderProps) {
  const spec = readSpec(config);
  const rows = data?.rows ?? [];
  if (rows.length === 0) return <NoData />;

  const items = buildRankItems(spec, rows);
  const color = spec.color ?? "#0a84ff";

  return (
    <div className="flex flex-col justify-center gap-3">
      {items.map((item, i) => (
        <Meter
          key={`${item.label}-${i}`}
          label={item.label}
          value={item.pct}
          customValue={
            item.secondary
              ? `${formatValue(item.value, spec.format)} · ${item.secondary}`
              : formatValue(item.value, spec.format)
          }
          style={{ "--rank-list-color": color } as CSSProperties}
          indicatorClassName="bg-none bg-(--rank-list-color)"
        />
      ))}
    </div>
  );
}
