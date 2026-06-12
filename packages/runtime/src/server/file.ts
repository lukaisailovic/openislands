import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Confined, read-only project-file access for the `source.doc` island. Untrusted
 * `?path=` input must stay under the project root, clear the dotfile/secret
 * denylist, and live in a content directory — never reach config or escape the root.
 */
const ALLOWED_DIRS = ["data", "docs", "app"];

const CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export class FileAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FileAccessError";
  }
}

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
  return rootRelative
    .split(/[\\/]/)
    .some((seg) => seg.startsWith(".") && seg !== "." && seg !== "..");
}

/** Resolve `candidate` under the project root or throw a FileAccessError with an HTTP status. */
export function confineProjectFile(projectRoot: string, candidate: string): string {
  if (!candidate) throw new FileAccessError("missing 'path'", 400);
  const root = realRoot(projectRoot);
  const abs = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new FileAccessError("path escapes the project root", 403);
  }
  if (isDenied(rel)) throw new FileAccessError("path targets a protected file", 403);
  const top = rel.split(/[\\/]/)[0];
  if (!top || !ALLOWED_DIRS.includes(top)) {
    throw new FileAccessError(`path must live under ${ALLOWED_DIRS.join("/, ")}/`, 403);
  }
  return abs;
}

function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export interface FileResult {
  status: number;
  body: Uint8Array | string;
  contentType: string;
}

export function readProjectFile(projectRoot: string, candidate: string): FileResult {
  try {
    const abs = confineProjectFile(projectRoot, candidate);
    const buffer = readFileSync(abs);
    return { status: 200, body: buffer, contentType: contentType(abs) };
  } catch (err) {
    if (err instanceof FileAccessError) {
      return { status: err.status, body: err.message, contentType: "text/plain; charset=utf-8" };
    }
    return { status: 404, body: "not found", contentType: "text/plain; charset=utf-8" };
  }
}
