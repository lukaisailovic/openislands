/**
 * Path confinement — the filesystem boundary the MCP server enforces on every
 * tool input. Untrusted input (manifest dataset sources, proposal/checkpoint
 * ids, raw paths) must never escape the project root, touch a secret, or write
 * anywhere but the single sanctioned manifest path.
 *
 * Rules:
 *   - Everything resolves under the realpath of the project root.
 *   - Dotfiles/secrets are denied for both read and write: `.env*` and the
 *     `.openislands/` internals are off-limits to any tool input. (The server
 *     reads/writes `.openislands/` itself via dedicated, fixed paths — never
 *     via a path derived from a tool argument.)
 *   - Writes are confined to `app/manifest.json`. Nothing else is ever written.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export class PathConfinementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathConfinementError";
  }
}

/** Realpath of an existing ancestor, so confinement holds even before a leaf exists. */
function realRoot(projectRoot: string): string {
  let dir = resolve(projectRoot);
  for (;;) {
    try {
      return realpathSync(dir);
    } catch {
      const parent = resolve(dir, "..");
      if (parent === dir) return dir;
      dir = parent;
    }
  }
}

function isDenied(rootRelative: string): boolean {
  const segments = rootRelative.split(/[\\/]/);
  return segments.some((seg) => seg === ".env" || seg.startsWith(".env.") || seg === ".openislands");
}

/**
 * Resolve `candidate` (absolute or root-relative) and assert it stays inside the
 * project root and clears the secret denylist. Returns the resolved absolute path.
 */
export function confineReadable(projectRoot: string, candidate: string): string {
  const root = realRoot(projectRoot);
  const abs = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathConfinementError(`path '${candidate}' resolves outside the project root`);
  }
  if (isDenied(rel)) throw new PathConfinementError(`path '${candidate}' targets a protected file`);
  return abs;
}

const WRITABLE_DIRS = ["app", "models", "data"];

/** Assert a dataset source path is allowed to be read (confined + in a data dir). */
export function confineDatasetSource(projectRoot: string, source: string): string {
  const abs = confineReadable(projectRoot, source);
  const root = realRoot(projectRoot);
  const rel = relative(root, abs);
  const top = rel.split(/[\\/]/)[0];
  if (!top || !WRITABLE_DIRS.includes(top)) {
    throw new PathConfinementError(`dataset source '${source}' must live under ${WRITABLE_DIRS.join("/, ")}/`);
  }
  return abs;
}
