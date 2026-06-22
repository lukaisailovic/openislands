"use client";

import { type CSSProperties, lazy, Suspense, useEffect, useRef, useState } from "react";

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
// all of which are browser-only and large, and each renderer is itself lazy in the
// registry — so a tile only pays for its own libraries when it actually mounts. We
// gate the lazy impl on the placeholder entering the viewport (with a 256px head
// start) instead of mounting on hydration: an above-the-fold tile intersects right
// away and upgrades immediately, while a below-the-fold chart leaves ECharts off the
// initial load until the reader scrolls toward it. The server and the first client
// render both draw the same sized placeholder, keeping the prerender/SSR graph free of
// these libraries and hydration byte-identical.
const LiveIslandImpl = lazy(() => import("./live-island-impl"));

export function LiveIsland(props: LiveIslandProps) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }

    const placeholder = placeholderRef.current;
    if (!placeholder) {
      setMounted(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        setMounted(true);
        observer.disconnect();
      },
      { rootMargin: "256px" },
    );
    observer.observe(placeholder);

    return () => observer.disconnect();
  }, []);

  const height = props.height ?? DEFAULT_HEIGHT;
  const style = { minHeight: `${height}px` } as CSSProperties;

  if (!mounted) {
    const placeholderClass =
      props.framed === false
        ? "oi-island-bare not-prose"
        : "not-prose my-4 rounded-xl border border-fd-border";
    return <div ref={placeholderRef} className={placeholderClass} style={style} />;
  }

  return (
    <Suspense fallback={<div style={style} />}>
      <LiveIslandImpl {...props} />
    </Suspense>
  );
}

export default LiveIsland;
