/**
 * Symlink-safe path confinement — the one correct implementation of "resolve a
 * candidate under a root and prove it can't escape", shared by every server-side
 * confiner (the runtime's /api/file + editor routes, the MCP path guard, the
 * compiler's dataset-source resolution).
 *
 * The subtle part is symlinks: resolving a candidate lexically (`resolve(root, p)`)
 * and string-comparing against the root passes a path like `data/link.md` even when
 * `link.md` is a symlink whose target lives outside the root — and `fs.writeFileSync`
 * follows that symlink. So containment must be checked against the REALPATH of the
 * candidate, not its lexical form. We realpath the deepest existing ancestor (which
 * resolves any symlink components in the part of the path that exists) and re-attach
 * the not-yet-created tail, so the check holds even before the leaf exists.
 *
 * Callers layer their own policy (`isHiddenPath` denylist, allowed subdirs) on top of
 * the returned root-relative path.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Realpath of the deepest existing ancestor of `p`, with the non-existent tail re-attached. */
function realpathOrAncestor(p: string): string {
  let dir = p;
  let tail = "";
  for (;;) {
    try {
      return tail ? resolve(realpathSync(dir) + tail) : realpathSync(dir);
    } catch {
      tail = sep + basename(dir) + tail;
      const parent = dirname(dir);
      if (parent === dir) return p;
      dir = parent;
    }
  }
}

export interface ConfinedPath {
  /** The realpath-resolved absolute path — safe to hand to fs (no surviving symlink escape). */
  abs: string;
  /** The path relative to the project root. */
  rel: string;
}

/**
 * Resolve `candidate` (absolute or root-relative) under `root` and assert its realpath
 * stays inside the root. Returns the resolved path + its root-relative form, or `null`
 * if it escapes (via `..`, an absolute path outside, or a symlink pointing out).
 */
export function resolveWithinRoot(root: string, candidate: string): ConfinedPath | null {
  const realRoot = realpathOrAncestor(resolve(root));
  const lexical = isAbsolute(candidate) ? resolve(candidate) : resolve(realRoot, candidate);
  const abs = realpathOrAncestor(lexical);
  const rel = relative(realRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return { abs, rel };
}

/** A confined root-relative path whose segments include a dotfile (`.env`, `.openislands`, …). */
export function isHiddenPath(rel: string): boolean {
  return rel.split(/[\\/]/).some((seg) => seg.startsWith(".") && seg !== "." && seg !== "..");
}
