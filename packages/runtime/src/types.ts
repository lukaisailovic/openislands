import type { Column, Row } from "@openislands/compiler";

export type { Column, Row };

/** A single island's typed config as it lives in the manifest. */
export type IslandConfig = Record<string, unknown> & { type: string; dataset?: string };

export interface QueryPayload {
  dataset: string;
  columns: Column[];
  rows: Row[];
}

/**
 * A contract failure surfaced to an island. Mirrors the compiler's contract
 * check and the schema's IslandError — enough for the in-island error card to
 * tell the user exactly what their agent must fix.
 */
export interface IslandQueryError {
  dataset?: string;
  field?: string;
  missingFields?: string[];
  message: string;
}

/** Props every island renderer receives. Data is absent until the client query resolves. */
export interface IslandRenderProps {
  config: IslandConfig;
  data?: QueryPayload;
}

/** A custom island discovered on disk: its cache-busting version (the component's mtime). */
export interface CustomIslandInfo {
  version: number;
}

/** Map of custom island type → discovery info, threaded from the dashboard loader to the client. */
export type CustomIslandMap = Record<string, CustomIslandInfo>;

/** SSE payloads the runtime emits on /api/events. */
export type RuntimeEvent =
  | { type: "datasets-changed"; datasets: string[] }
  | { type: "validation"; islandErrors: IslandValidationError[] }
  | { type: "components-changed" }
  | { type: "connectors-changed" };

export interface IslandValidationError {
  page: string;
  index: number;
  type: string;
  field?: string;
  message: string;
}
