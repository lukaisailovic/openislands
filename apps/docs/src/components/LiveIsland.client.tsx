"use client";

import type { CSSProperties } from "react";
import { resolveRenderer } from "@openislands/runtime/islands";

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
}

const DEFAULT_HEIGHT = 220;

/**
 * Renders a real OpenIslands island inside the docs by resolving the same
 * renderer the runtime uses and feeding it a manifest island plus an inline
 * query result, framed like a dashboard tile.
 *
 * Chart-bearing islands read the OS color scheme and mount ECharts in an
 * effect, so this lives in a client component. The renderers stay SSR-safe —
 * they guard `document` and fall back to a `false` color scheme on the server,
 * so the build never crashes — and the full styled island (value, delta,
 * sparkline, markdown) resolves once the client hydrates.
 */
export function LiveIsland({ type, config, data, height = DEFAULT_HEIGHT }: LiveIslandProps) {
  const Renderer = resolveRenderer(type);
  const frameStyle = { minHeight: `${height}px` } as CSSProperties;

  return (
    <div className="oi-tile-frame not-prose my-4" style={frameStyle}>
      <Renderer config={{ ...config, type }} data={data as never} />
    </div>
  );
}

export default LiveIsland;
