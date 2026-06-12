import type { IslandRenderer } from "./registry.js";

/**
 * A render-time lookup that breaks the import cycle between RowDetailsDialog and
 * the island registry: the dialog embeds a drilldown island but lives upstream
 * of the registry (islands → RowDetailsDialog → registry would cycle). The
 * registry populates this on load; the dialog reads it at render time.
 */
let resolve: ((type: string) => IslandRenderer) | undefined;

export function setDrilldownResolver(fn: (type: string) => IslandRenderer): void {
  resolve = fn;
}

export function resolveDrilldownRenderer(type: string): IslandRenderer | undefined {
  return resolve?.(type);
}
