/**
 * @openislands/runtime — the TanStack Start SSR app and island registry.
 *
 * The Start app (routes, server handlers, client entry) is built by `vite build`
 * at package build time and booted by `openislands serve`, which sets
 * OPENISLANDS_PROJECT_DIR to the user's project. This module is the importable
 * surface: the registry, the renderers, the query/event server logic, and the
 * shared types that island authors and the CLI build on.
 */
export type {
  Column,
  IslandConfig,
  IslandQueryError,
  IslandRenderProps,
  IslandValidationError,
  QueryPayload,
  Row,
  RuntimeEvent,
} from "./types.js";

export {
  islandNeedsData,
  type IslandRenderer,
  registerIsland,
  resolveRenderer,
} from "./islands/registry.js";
export { formatValue } from "./islands/format.js";

export {
  ARROW_CONTENT_TYPE,
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  negotiateFormat,
  parseQueryParams,
  type QueryHandlerResult,
  type QueryRequest,
  type ResponseFormat,
  runQuery,
} from "./server/query.js";
export { createEventStream, formatEvent, SSE_HEADERS } from "./server/events.js";
export { loadManifest, projectDir } from "./server/project.js";
export {
  appDir,
  appDirFromParams,
  type AppResolution,
  isSafeAppId,
  listApps,
  readWorkspaceConfig,
  resetWorkspaceCache,
  scanWorkspaceApps,
  type WorkspaceApp,
  type WorkspaceConfig,
  workspaceRoot,
} from "./server/workspace.js";
export {
  affectedDatasets,
  broadcasterFor,
  ensureWatcher,
  eventsForChange,
  mergeEvents,
  RuntimeEventBroadcaster,
  startWatcher,
  type WatchHandle,
} from "./server/watcher.js";
export {
  applyValidation,
  handleRuntimeEvent,
  invalidateDatasets,
  islandErrorKey,
  queryKeyMatchesDatasets,
  useLiveUpdates,
} from "./client/useLiveUpdates.js";

export { IslandErrorCard } from "./components/IslandErrorCard.js";
export { IslandTile } from "./components/IslandTile.js";
export { Dashboard } from "./components/Dashboard.js";
