/**
 * Shared editor primitives split out so both the `/api/editor/*` routes and the
 * file watcher can agree on what counts as an editable text file and on which
 * disk writes the routes performed themselves. The self-write registry lets the
 * watcher suppress a `files-changed` echo for a change a route already
 * broadcast, while still emitting it for genuinely external edits. Imports
 * nothing from editorRoutes/watcher to stay free of a module cycle.
 */
import { realpathSync } from "node:fs";
import { extname } from "node:path";

export const EDITOR_EXTENSIONS = new Set(["md", "markdown", "txt", "csv"]);

/** Lowercase extension without the dot, e.g. `docs/a.MD` → `md`. */
export function fileExtension(path: string): string {
  return extname(path).slice(1).toLowerCase();
}

export function isEditableTextFile(path: string): boolean {
  return EDITOR_EXTENSIONS.has(fileExtension(path));
}

const SELF_WRITE_TTL_MS = 2_000;

const selfWrites = new Map<string, number>();

function selfWriteKey(projectDir: string, rel: string): string {
  return `${realpathSync(projectDir)}\0${rel}`;
}

/** Record a project-relative path our own route just wrote, so the watcher skips its echo. */
export function markSelfWrite(projectDir: string, rel: string): void {
  selfWrites.set(selfWriteKey(projectDir, rel), Date.now() + SELF_WRITE_TTL_MS);
}

/** True iff a non-expired self-write mark exists for the path; consumes it and prunes stale entries. */
export function takeSelfWrite(projectDir: string, rel: string): boolean {
  const now = Date.now();
  for (const [key, expires] of selfWrites) if (expires <= now) selfWrites.delete(key);
  const key = selfWriteKey(projectDir, rel);
  const expires = selfWrites.get(key);
  if (expires == null || expires <= now) return false;
  selfWrites.delete(key);
  return true;
}
