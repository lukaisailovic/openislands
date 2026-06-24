/**
 * Path confinement — the filesystem boundary the MCP server enforces on every
 * tool input. Untrusted input (manifest dataset sources, proposal/checkpoint
 * ids, raw paths) must never escape the project root, touch a secret, or write
 * anywhere but the single sanctioned manifest path.
 *
 * Rules:
 *   - Everything resolves under the realpath of the project root, and the
 *     resolved path's own realpath must stay inside it — so a symlink under a
 *     content dir can't smuggle a tool input out of the root.
 *   - Dotfiles/secrets are denied for both read and write: `.env*` and the
 *     `.openislands/` internals are off-limits to any tool input. (The server
 *     reads/writes `.openislands/` itself via dedicated, fixed paths — never
 *     via a path derived from a tool argument.)
 *   - Writes are confined to `manifest.json`. Nothing else is ever written.
 */
import { resolveWithinRoot } from "@openislands/storage";

export class PathConfinementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathConfinementError";
  }
}

function isDenied(rootRelative: string): boolean {
  const segments = rootRelative.split(/[\\/]/);
  return segments.some((seg) => seg === ".env" || seg.startsWith(".env.") || seg === ".openislands");
}

/**
 * Resolve `candidate` (absolute or root-relative) and assert its realpath stays inside the
 * project root and clears the secret denylist. Returns the resolved absolute path.
 */
export function confineReadable(projectRoot: string, candidate: string): string {
  const confined = resolveWithinRoot(projectRoot, candidate);
  if (!confined) throw new PathConfinementError(`path '${candidate}' resolves outside the project root`);
  if (isDenied(confined.rel)) throw new PathConfinementError(`path '${candidate}' targets a protected file`);
  return confined.abs;
}

/** Top-level dirs a dataset source / sql transform may live under. `docs/` is here
 * because markdown files are a first-class dataset source (a `source.doc` island or
 * a markdown dataset). Action writability is enforced downstream by the writer, not here. */
const SOURCE_DIRS = ["data", "docs", "models"];

/** Assert a dataset source path is allowed to be read (confined + in a source dir). */
export function confineDatasetSource(projectRoot: string, source: string): string {
  const confined = resolveWithinRoot(projectRoot, source);
  if (!confined) throw new PathConfinementError(`path '${source}' resolves outside the project root`);
  if (isDenied(confined.rel)) throw new PathConfinementError(`path '${source}' targets a protected file`);
  const top = confined.rel.split(/[\\/]/)[0];
  if (!top || !SOURCE_DIRS.includes(top)) {
    throw new PathConfinementError(`dataset source '${source}' must live under ${SOURCE_DIRS.join("/, ")}/`);
  }
  return confined.abs;
}
