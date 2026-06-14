/**
 * The storage seam. Every consumer resolves its stores through these getters,
 * keyed by an opaque `appKey` (today the project directory). The default
 * factories return the local-disk adapters, so nothing changes until something
 * calls `configureStorage(...)` once at boot to swap in other implementations:
 *
 *     configureStorage({
 *       content:  (key) => new MyContentStore(key),
 *       appState: (key) => new MyAppStateStore(key),
 *       versions: (key) => new MyVersionStore(key),
 *     });
 *
 * `versions` has no default: the DuckDB-backed local implementation lives in the
 * runtime (to keep this package engine-free), and the runtime registers it at
 * boot. Resolving a VersionStore before one is configured is a loud error.
 */
import { type AppStateStore, LocalAppStateStore } from "./state.js";
import { type ContentStore, LocalContentStore } from "./content.js";
import type { VersionStore } from "./versions.js";

export type StoreFactory<T> = (appKey: string) => T;

let contentFactory: StoreFactory<ContentStore> = (key) => new LocalContentStore(key);
let appStateFactory: StoreFactory<AppStateStore> = (key) => new LocalAppStateStore(key);
let versionFactory: StoreFactory<VersionStore> | null = null;

/** Resolve the {@link ContentStore} for an app. */
export function getContentStore(appKey: string): ContentStore {
  return contentFactory(appKey);
}

/** Resolve the {@link AppStateStore} for an app. */
export function getAppStateStore(appKey: string): AppStateStore {
  return appStateFactory(appKey);
}

/** Resolve the {@link VersionStore} for an app. Throws until one is configured. */
export function getVersionStore(appKey: string): VersionStore {
  if (!versionFactory) {
    throw new Error("no VersionStore configured — call configureStorage({ versions }) at boot");
  }
  return versionFactory(appKey);
}

/** Whether a VersionStore factory has been registered. */
export function hasVersionStore(): boolean {
  return versionFactory !== null;
}

export interface StorageConfig {
  content?: StoreFactory<ContentStore>;
  appState?: StoreFactory<AppStateStore>;
  versions?: StoreFactory<VersionStore>;
}

/** Install custom store factories. Any omitted port keeps its current factory. */
export function configureStorage(config: StorageConfig): void {
  if (config.content) contentFactory = config.content;
  if (config.appState) appStateFactory = config.appState;
  if (config.versions) versionFactory = config.versions;
}

/** Restore the built-in local factories (and clear the version factory). For tests. */
export function resetStorage(): void {
  contentFactory = (key) => new LocalContentStore(key);
  appStateFactory = (key) => new LocalAppStateStore(key);
  versionFactory = null;
}
