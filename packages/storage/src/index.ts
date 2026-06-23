/**
 * @openislands/storage — the storage ports that decouple OpenIslands from the
 * local filesystem. Three swappable adapters, resolved per app through a factory
 * registry:
 *
 *   - ContentStore   — an app's content (manifest, data files, SQL, docs, code)
 *   - AppStateStore  — the tool's own per-app state under `.openislands/`
 *   - VersionStore   — the content.editor per-file version history
 *
 * Consumers call `getContentStore(appKey)` / `getAppStateStore(appKey)` /
 * `getVersionStore(appKey)`; `configureStorage(...)` swaps in a different backend
 * at boot. The default adapters use local disk. See `registry.ts`.
 */
export type { ContentStore } from "./content.js";
export { LocalContentStore } from "./content.js";
export { type ConfinedPath, isHiddenPath, resolveWithinRoot } from "./confine.js";
export type { AppStateStore } from "./state.js";
export { LocalAppStateStore } from "./state.js";
export type { VersionStore } from "./versions.js";
export type { DirEntry, FileStat, QueryConnection, StateEntry, VersionMeta } from "./types.js";
export {
  type StorageConfig,
  type StoreFactory,
  configureStorage,
  getAppStateStore,
  getContentStore,
  getVersionStore,
  hasVersionStore,
  resetStorage,
} from "./registry.js";
