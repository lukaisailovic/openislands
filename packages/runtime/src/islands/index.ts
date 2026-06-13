/**
 * The browser-safe island surface: the renderer registry and value formatting,
 * with none of the package root's server modules (which pull in node:fs/path and
 * the DuckDB compiler). Import this from environments that only render islands —
 * e.g. a docs site embedding a live island.
 */
export {
  islandNeedsData,
  type IslandRenderer,
  registerIsland,
  resolveRenderer,
} from "./registry.js";
export { formatValue } from "./format.js";
export type { IslandConfig, IslandRenderProps, QueryPayload } from "../types.js";
