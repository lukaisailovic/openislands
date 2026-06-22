"use client";

import { type CSSProperties, lazy, Suspense, useEffect, useState } from "react";

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
   * Wrap the island in the runtime's IslandCard (header, title, source button) so it
   * reads exactly like a dashboard tile — the default. Pass `false` to render the
   * island bare, for a host that supplies its own frame (the landing page).
   */
  framed?: boolean;
}

export const DEFAULT_HEIGHT = 220;

// The real renderer pulls in the runtime registry (ECharts, Lexical, the world map),
// all of which are browser-only and large. Keeping it behind a lazy import that only
// resolves after mount keeps every one of those libraries out of the prerender/SSR
// graph: the server renders a sized placeholder and the live tile hydrates in client-
// side, exactly as the runtime draws it in a real dashboard.
const LiveIslandImpl = lazy(() => import("./live-island-impl"));

export function LiveIsland(props: LiveIslandProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const height = props.height ?? DEFAULT_HEIGHT;
  const style = { minHeight: `${height}px` } as CSSProperties;

  if (!mounted) {
    if (props.framed === false) {
      return <div className="oi-island-bare not-prose" style={style} />;
    }
    return <div className="not-prose my-4 rounded-xl border border-fd-border" style={style} />;
  }

  return (
    <Suspense fallback={<div style={style} />}>
      <LiveIslandImpl {...props} />
    </Suspense>
  );
}

export default LiveIsland;
