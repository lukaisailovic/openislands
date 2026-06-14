import type { EditorFile, EditorGroup } from "./types.js";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a glob to an anchored RegExp source. `**` spans path segments
 * (including none), `*` stays within a segment, and `?` is a single non-slash
 * character. A leading `**​/` also matches a file at the root.
 */
function globToRegExpSource(pattern: string): string {
  const chars = [...pattern];
  let source = "";
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === undefined) break;
    if (char === "*") {
      if (chars[i + 1] !== "*") {
        source += "[^/]*";
        continue;
      }
      const followedBySlash = chars[i + 2] === "/";
      i += followedBySlash ? 2 : 1;
      source += followedBySlash ? "(?:.*/)?" : ".*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeForRegExp(char);
  }
  return `^${source}$`;
}

const globCache = new Map<string, RegExp>();

function globMatcher(pattern: string): RegExp {
  const cached = globCache.get(pattern);
  if (cached) return cached;
  const matcher = new RegExp(globToRegExpSource(pattern));
  globCache.set(pattern, matcher);
  return matcher;
}

export function matchGlob(relPath: string, pattern: string): boolean {
  return globMatcher(pattern).test(relPath);
}

/** A file's path relative to the editor's `dir`, normalized to posix and unprefixed. */
export function relativeToDir(path: string, dir: string): string {
  const normalizedDir = dir.replace(/\/+$/, "");
  if (!normalizedDir) return path;
  const prefix = `${normalizedDir}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function includeFilter(
  files: EditorFile[],
  include: string[] | undefined,
  dir: string,
  csv: boolean,
): EditorFile[] {
  if (include && include.length > 0) {
    return files.filter((file) =>
      include.some((pattern) => matchGlob(relativeToDir(file.path, dir), pattern)),
    );
  }
  return files.filter((file) => {
    const ext = file.ext.toLowerCase();
    if (MARKDOWN_EXTENSIONS.has(ext)) return true;
    return csv && ext === "csv";
  });
}

export interface FileGroup {
  group: EditorGroup;
  files: EditorFile[];
}

const UNGROUPED: EditorGroup = { id: "__ungrouped__", label: "Ungrouped", match: [] };

/**
 * Partition files into the author's virtual folders: each file lands in the
 * FIRST group whose any glob matches its path relative to `dir`; the rest fall
 * into a trailing "Ungrouped" bucket. Group order is preserved; empty groups are
 * dropped. With no groups, every file is Ungrouped (one bucket).
 */
export function groupFiles(
  files: EditorFile[],
  dir: string,
  groups: EditorGroup[] | undefined,
): FileGroup[] {
  const defined = groups ?? [];
  const buckets = new Map<string, EditorFile[]>();
  for (const group of defined) buckets.set(group.id, []);
  const ungrouped: EditorFile[] = [];

  for (const file of files) {
    const rel = relativeToDir(file.path, dir);
    const owner = defined.find((group) => group.match.some((pattern) => matchGlob(rel, pattern)));
    if (owner) {
      buckets.get(owner.id)?.push(file);
      continue;
    }
    ungrouped.push(file);
  }

  const result: FileGroup[] = [];
  for (const group of defined) {
    const matched = buckets.get(group.id) ?? [];
    if (matched.length > 0) result.push({ group, files: matched });
  }
  if (ungrouped.length > 0) result.push({ group: UNGROUPED, files: ungrouped });
  return result;
}
