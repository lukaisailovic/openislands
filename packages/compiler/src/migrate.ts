/**
 * Code migrations — one-time, idempotent fixups that bring an app's on-disk
 * layout up to date the first time the CLI/runtime/MCP touches it. Like a DB
 * migration, but for the project structure: each migration declares its own
 * precondition and applies a fix, so re-running is a safe no-op — the disk state
 * is the ledger, there is no tracking file to drift out of sync.
 *
 * They run at the workspace-structure level the app scans already work at (raw
 * `node:fs` over `apps/<id>/`), which is why they sit outside the ContentStore
 * content port. Keep every migration idempotent and silent (the MCP server speaks
 * JSON-RPC over stdout — a stray log would corrupt the protocol).
 */
import { existsSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { join } from "node:path";

interface AppMigration {
  id: string;
  /** Bring one app dir's layout up to date — idempotent, a no-op once applied. */
  apply(appDir: string): void;
}

/** `apps/<id>/app/manifest.json` → `apps/<id>/manifest.json` — drop the `app/` wrapper dir. */
const flattenManifest: AppMigration = {
  id: "0001-flatten-manifest",
  apply(appDir: string): void {
    const nested = join(appDir, "app", "manifest.json");
    if (!existsSync(nested)) return;
    const flat = join(appDir, "manifest.json");
    if (existsSync(flat)) return; // already flat (or a conflicting copy) — never clobber the canonical manifest
    renameSync(nested, flat);
    const wrapper = join(appDir, "app");
    if (readdirSync(wrapper).length === 0) rmdirSync(wrapper);
  },
};

// ponytail: the registry seam — append future layout migrations here. `id` names each one
// for the day a ledger/log needs it; today idempotent preconditions make a ledger unnecessary.
const MIGRATIONS: AppMigration[] = [flattenManifest];

/** Bring one app dir's layout up to date. Idempotent, and cheap once migrated. */
export function migrateApp(appDir: string): void {
  for (const migration of MIGRATIONS) migration.apply(appDir);
}
