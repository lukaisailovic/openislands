"use client";

import type { CSSProperties } from "react";
import { IslandCard, resolveRenderer, type Column, type SourceInfo } from "@openislands/runtime/islands";

type ColumnType = Column["type"];

export interface LiveIslandColumn {
  name: string;
  type: string;
}

export interface LiveIslandData {
  dataset: string;
  columns: LiveIslandColumn[];
  rows: Record<string, unknown>[];
}

export interface LiveIslandProps {
  type: string;
  config: Record<string, unknown>;
  data?: LiveIslandData;
  height?: number;
  /**
   * Wrap the island in the runtime's {@link IslandCard} (header, title, source
   * button) so it reads exactly like a dashboard tile — the default. Pass
   * `false` to render the island bare, for a host that supplies its own frame
   * (the landing page drops one into a custom panel with its own header).
   */
  framed?: boolean;
}

const DEFAULT_HEIGHT = 220;

/**
 * Bucket a DuckDB-style type name (what docs authors write — `bigint`, `double`,
 * `varchar`, `timestamp`) into the runtime's coarse {@link ColumnType}, matching
 * how the compiler classifies real query columns. Unrecognized names read as
 * text, mirroring the compiler's own fallback.
 */
function columnTypeFrom(name: string): ColumnType {
  const type = name.toLowerCase();
  if (type === "boolean" || type === "bool") return "boolean";
  if (type.startsWith("date") || type.startsWith("time")) return "date";
  if (/(int|float|double|decimal|numeric|real)/.test(type)) return "number";
  return "string";
}

function sourceFrom(data: LiveIslandData | undefined): SourceInfo | null {
  if (!data) return null;
  const columns: Column[] = data.columns.map(({ name, type }) => ({
    name,
    type: columnTypeFrom(type),
  }));
  return { name: data.dataset, kind: "file", columns };
}

/**
 * Renders a real OpenIslands island inside the docs by resolving the same
 * renderer the runtime uses. Framed (the default), it wraps that renderer in the
 * runtime's own {@link IslandCard} — header, title, and a source button that
 * lists the sample dataset's columns — so an island in the docs is the very tile
 * a user sees in their app, doubling as a live data contract for the reader.
 *
 * Chart-bearing islands read the OS color scheme and mount ECharts in an
 * effect, so this lives in a client component. The renderers stay SSR-safe —
 * they guard `document` and fall back to a `false` color scheme on the server,
 * so the build never crashes — and the full styled island resolves once the
 * client hydrates.
 */
export function LiveIsland({
  type,
  config,
  data,
  height = DEFAULT_HEIGHT,
  framed = true,
}: LiveIslandProps) {
  const Renderer = resolveRenderer(type);
  const style = { minHeight: `${height}px` } as CSSProperties;
  const island = <Renderer config={{ ...config, type }} data={data as never} />;

  if (!framed) {
    return (
      <div className="oi-island-bare not-prose" style={style}>
        {island}
      </div>
    );
  }

  return (
    <IslandCard
      className="not-prose my-4"
      style={style}
      title={config.title as string | undefined}
      source={sourceFrom(data)}
    >
      {island}
    </IslandCard>
  );
}

export default LiveIsland;
